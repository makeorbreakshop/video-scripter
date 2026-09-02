// Paced back-catalog backfill for user-tracked channels.
// Drains backfill_jobs (kind 'catalog') one channel at a time: walks the
// uploads playlist (UU + channel id) via playlistItems (1 unit / 50 ids),
// fetches metadata for ids we don't have (videos.list, 1 unit / 50), skips
// Shorts and live, and inserts videos + one same-day view_snapshots row.
//
// Direct Postgres only — never supabase-js (2026-08-31 egress incident).
// Idempotent and safe to re-run: every insert is `on conflict do nothing`.
//
// Usage:
//   npx tsx scripts/backfill-catalog.ts --dry
//   npx tsx scripts/backfill-catalog.ts --channel UC… [--depth 300]
//   npx tsx scripts/backfill-catalog.ts [--budget 1500] [--jobs 5]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { chunk, clampCount } from '../lib/nightly/tracking-core';
import { CHANNEL_ID_RE, uploadsPlaylistId } from '../lib/app/channels-core';

const YT = 'https://www.googleapis.com/youtube/v3';
const CATEGORY = 'backfill';
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const PAGE_SLEEP_MS = 1200;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] ?? '' : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const DRY = flag('dry');
const ONLY_CHANNEL = arg('channel');
const DEPTH = parseInt(arg('depth') || '100000', 10); // default: the whole catalog
const BUDGET = parseInt(arg('budget') || '1500', 10);
const MAX_JOBS = parseInt(arg('jobs') || '5', 10);

const API_KEY = process.env.YOUTUBE_API_KEY!;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let unitsThisRun = 0;
let budgetRemaining = 0;

async function spentToday(): Promise<number> {
  const { rows } = await pool.query(
    `select coalesce(sum(units),0)::int as spent from quota_ledger where date = current_date and category = $1`,
    [CATEGORY]
  );
  return rows[0].spent as number;
}

async function ytJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Spend one unit if the budget allows. Returns false when the budget is gone. */
function takeUnit(): boolean {
  if (budgetRemaining <= 0) return false;
  budgetRemaining -= 1;
  unitsThisRun += 1;
  return true;
}

function isShortOrLive(v: any): boolean {
  const m = String(v?.contentDetails?.duration || '').match(/^PT(?:(\d+)M)?(?:(\d+)S)?$/);
  if (m && parseInt(m[1] || '0', 10) * 60 + parseInt(m[2] || '0', 10) <= 62) return true;
  const bc = v?.snippet?.liveBroadcastContent;
  return bc === 'live' || bc === 'upcoming';
}

async function insertVideo(v: any): Promise<boolean> {
  const sn = v.snippet || {};
  const st = v.statistics || {};
  const views = clampCount(parseInt(st.viewCount || '0', 10));
  const likes = clampCount(parseInt(st.likeCount || '0', 10));
  const comments = clampCount(parseInt(st.commentCount || '0', 10));
  try {
    const r = await pool.query(
      `insert into videos (id, title, description, channel_id, channel_name, published_at,
                           view_count, like_count, comment_count, duration, thumbnail_url,
                           data_source, is_competitor, import_date, updated_at, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'user',true,now(),now(),$12)
       on conflict (id) do nothing`,
      [v.id, sn.title || '', (sn.description || '').slice(0, 50000), sn.channelId,
       sn.channelTitle || '', sn.publishedAt, views, likes, comments,
       v.contentDetails?.duration || null,
       sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || null, SYSTEM_USER]
    );
    await pool.query(
      `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published)
       values ($1, current_date, $2, $3, $4, greatest(0, current_date - $5::date))
       on conflict (video_id, snapshot_date) do nothing`,
      [v.id, views, likes, comments, sn.publishedAt]
    );
    return (r.rowCount ?? 0) > 0;
  } catch (e: any) {
    console.error(`  insert ${v.id} failed: ${e.message}`);
    return false;
  }
}

interface Outcome { pages: number; seen: number; newIds: number; inserted: number; units: number; exhausted: boolean }

async function backfillChannel(channelId: string, depth: number): Promise<Outcome> {
  const startUnits = unitsThisRun;
  const playlist = uploadsPlaylistId(channelId);
  let pageToken: string | undefined;
  let pages = 0;
  const seen: string[] = [];
  let exhausted = false;

  // 1. Walk the uploads playlist, newest first, up to `depth` ids.
  while (seen.length < depth) {
    if (!takeUnit()) { exhausted = true; break; }
    const url = `${YT}/playlistItems?part=contentDetails&maxResults=50&playlistId=${playlist}` +
                `&key=${API_KEY}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const d = await ytJson(url);
    pages++;
    for (const it of d.items || []) {
      const id = it.contentDetails?.videoId;
      if (id && seen.length < depth) seen.push(id);
    }
    pageToken = d.nextPageToken;
    if (!pageToken) break;
    await sleep(PAGE_SLEEP_MS);
  }

  // 2. Which of those do we not already have?
  const newIds: string[] = [];
  for (const group of chunk(seen, 2000)) {
    const { rows } = await pool.query(`select id from videos where id = any($1)`, [group]);
    const known = new Set(rows.map((r) => r.id));
    newIds.push(...group.filter((id) => !known.has(id)));
  }

  // 3. Metadata for the unknown ids, 50 at a time.
  let inserted = 0;
  for (const group of chunk(newIds, 50)) {
    if (!takeUnit()) { exhausted = true; break; }
    const d = await ytJson(`${YT}/videos?part=snippet,statistics,contentDetails&id=${group.join(',')}&key=${API_KEY}`);
    for (const v of d.items || []) {
      if (isShortOrLive(v)) continue;
      if (await insertVideo(v)) inserted++;
    }
    await sleep(PAGE_SLEEP_MS);
  }

  return { pages, seen: seen.length, newIds: newIds.length, inserted, units: unitsThisRun - startUnits, exhausted };
}

async function logQuota(units: number) {
  if (units <= 0) return;
  await pool.query(`insert into quota_ledger (category, units) values ($1, $2)`, [CATEGORY, units]).catch(() => {});
  await pool.query(
    `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
     on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`,
    [units]
  ).catch(() => {});
}

async function main() {
  const spent = await spentToday();
  budgetRemaining = Math.max(0, BUDGET - spent);
  console.log(`Backfill budget: ${BUDGET} units/day, ${spent} already spent, ${budgetRemaining} available.`);

  // Single-channel proof run: no queue involved.
  if (ONLY_CHANNEL) {
    if (!CHANNEL_ID_RE.test(ONLY_CHANNEL)) throw new Error(`not a channel id: ${ONLY_CHANNEL}`);
    if (DRY) {
      console.log(`[dry] would backfill ${ONLY_CHANNEL} to depth ${DEPTH} (<= ${Math.ceil(DEPTH / 50) * 2} units)`);
      return;
    }
    const o = await backfillChannel(ONLY_CHANNEL, DEPTH);
    await logQuota(o.units);
    console.log(`${ONLY_CHANNEL}: ${o.pages} playlist pages, ${o.seen} ids seen, ${o.newIds} new, ${o.inserted} inserted, ${o.units} units${o.exhausted ? ' (budget exhausted)' : ''}`);
    return;
  }

  const { rows: jobs } = await pool.query(
    `select j.id, j.channel_id, coalesce(ct.backfill_depth, $2) as depth
       from backfill_jobs j
       left join channel_tracking ct on ct.channel_id = j.channel_id
      where j.kind = 'catalog' and j.status = 'queued'
      order by j.requested_at asc
      limit $1`,
    [MAX_JOBS, DEPTH]
  );
  console.log(`Queued catalog jobs: ${jobs.length}`);

  if (DRY) {
    for (const j of jobs) console.log(`[dry] job ${j.id} ${j.channel_id} depth ${j.depth} (<= ${Math.ceil(j.depth / 50) * 2} units)`);
    return;
  }

  for (const j of jobs) {
    if (budgetRemaining <= 0) { console.log('Budget exhausted; stopping.'); break; }
    // Claim the job; a concurrent drainer that already claimed it gets 0 rows.
    const claim = await pool.query(
      `update backfill_jobs set status = 'running', started_at = now()
        where id = $1 and status = 'queued' returning id`,
      [j.id]
    );
    if (!claim.rowCount) continue;
    await pool.query(`update channel_tracking set backfill_status = 'running' where channel_id = $1`, [j.channel_id]);

    const before = unitsThisRun;
    try {
      const o = await backfillChannel(j.channel_id, j.depth);
      await logQuota(o.units);
      const done = !o.exhausted;
      await pool.query(
        `update backfill_jobs set status = $2, finished_at = case when $2 = 'done' then now() else null end,
                                  units_spent = units_spent + $3, error = null where id = $1`,
        [j.id, done ? 'done' : 'queued', o.units]
      );
      await pool.query(`update channel_tracking set backfill_status = $2 where channel_id = $1`,
        [j.channel_id, done ? 'done' : 'queued']);
      console.log(`job ${j.id} ${j.channel_id}: ${o.seen} ids, ${o.inserted} inserted, ${o.units} units${done ? '' : ' (requeued, budget)'}`);
    } catch (e: any) {
      await logQuota(unitsThisRun - before); // only this job's spend
      await pool.query(
        `update backfill_jobs set status = 'failed', finished_at = now(), error = $2 where id = $1`,
        [j.id, String(e.message).slice(0, 500)]
      );
      await pool.query(`update channel_tracking set backfill_status = 'failed' where channel_id = $1`, [j.channel_id]);
      console.error(`job ${j.id} ${j.channel_id} failed: ${e.message}`);
    }
  }

  console.log(`Done. ${unitsThisRun} units spent this run.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
