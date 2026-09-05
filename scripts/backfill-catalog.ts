import { broadcastMetadataWrite } from '../lib/ingest/first-sample';
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
import { classifyForInsert, skipForInsert, type InsertClassification } from '../lib/ingest/classify';

const YT = 'https://www.googleapis.com/youtube/v3';
const CATEGORY = process.env.YOUTUBE_API_KEY_BACKUP ? 'backfill-backup' : 'backfill'; // ledger is per bucket
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const PAGE_SLEEP_MS = 1200;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] ?? '' : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const DRY = flag('dry');
const ONLY_CHANNEL = arg('channel');
const DEPTH = parseInt(arg('depth') || '300', 10);
const MAX_AGE_MS = 365 * 86_400_000; // never walk past a year of uploads
const BUDGET = parseInt(arg('budget') || '1500', 10);
const MAX_JOBS = parseInt(arg('jobs') || '5', 10);

// Backfill runs on the SECOND Data API project when one is configured, so the library walk
// has its own 10,000-unit day and never competes with tracking, scoring or the app. The
// per-bucket budget below is read from quota_ledger (category 'backfill'), not from
// youtube_quota_usage, which is the main key's bucket.
const ON_BACKUP_KEY = !!process.env.YOUTUBE_API_KEY_BACKUP;
const API_KEY = (process.env.YOUTUBE_API_KEY_BACKUP || process.env.YOUTUBE_API_KEY)!;
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

async function insertVideo(v: any, cls: InsertClassification): Promise<boolean> {
  const sn = v.snippet || {};
  const st = v.statistics || {};
  const views = clampCount(parseInt(st.viewCount || '0', 10));
  const likes = clampCount(parseInt(st.likeCount || '0', 10));
  const comments = clampCount(parseInt(st.commentCount || '0', 10));
  try {
    const r = await pool.query(
      `insert into videos (id, title, description, channel_id, channel_name, published_at,
                           view_count, like_count, comment_count, duration, thumbnail_url,
                           data_source, is_competitor, import_date, updated_at, user_id,
                           is_short, shorts_checked_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'user',true,now(),now(),$12,
               $13, case when $14::boolean then now() else null end)
       on conflict (id) do update set
         is_short = case when excluded.shorts_checked_at is not null then excluded.is_short else videos.is_short end,
         shorts_checked_at = coalesce(excluded.shorts_checked_at, videos.shorts_checked_at)
       returning (xmax = 0) as fresh`,
      [v.id, sn.title || '', (sn.description || '').slice(0, 50000), sn.channelId,
       sn.channelTitle || '', sn.publishedAt, views, likes, comments,
       v.contentDetails?.duration || null,
       sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || null, SYSTEM_USER,
       cls.is_short, cls.shorts_checked_at === 'now']
    );
    const broadcast = broadcastMetadataWrite(v);
    if (broadcast) await pool.query(broadcast.sql, broadcast.params);
    await pool.query(
      `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published)
       values ($1, current_date, $2, $3, $4, greatest(0, current_date - $5::date))
       on conflict (video_id, snapshot_date) do nothing`,
      [v.id, views, likes, comments, sn.publishedAt]
    );
    // `do update` always reports one row, so ask Postgres whether this row was actually new.
    return r.rows[0]?.fresh === true;
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
    const pageIds: string[] = [];
    let tooOld = false;
    for (const it of d.items || []) {
      const id = it.contentDetails?.videoId;
      const pub = it.contentDetails?.videoPublishedAt ? Date.parse(it.contentDetails.videoPublishedAt) : NaN;
      if (Number.isFinite(pub) && Date.now() - pub > MAX_AGE_MS) { tooOld = true; break; }
      if (id && seen.length < depth) { seen.push(id); pageIds.push(id); }
    }
    // Stop early when a whole page is already in the library: the rest is older and known.
    if (pageIds.length) {
      const { rows } = await pool.query(`select count(*)::int as n from videos where id = any($1)`, [pageIds]);
      if (rows[0].n === pageIds.length && pages > 1) break;
    }
    if (tooOld) break;
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
    const d = await ytJson(`${YT}/videos?part=snippet,statistics,contentDetails,liveStreamingDetails&id=${group.join(',')}&key=${API_KEY}`);
    for (const v of d.items || []) {
      // One shared Shorts/live rule (lib/ingest/classify.ts): 63-180s clips are settled against
      // YouTube, or inserted unverified so longformSql keeps them out until verify-shorts runs.
      const cls = await classifyForInsert(v);
      if (skipForInsert(cls.kind)) continue;
      if (await insertVideo(v, cls)) inserted++;
    }
    await sleep(PAGE_SLEEP_MS);
  }

  return { pages, seen: seen.length, newIds: newIds.length, inserted, units: unitsThisRun - startUnits, exhausted };
}

async function logQuota(units: number) {
  if (units <= 0) return;
  await pool.query(`insert into quota_ledger (category, units) values ($1, $2)`, [CATEGORY, units]).catch(() => {});
  // youtube_quota_usage is the MAIN key's bucket; only charge it when that is the key in use.
  if (!ON_BACKUP_KEY) {
    await pool.query(
      `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
       on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`,
      [units]
    ).catch(() => {});
  }
}

async function main() {
  const spent = await spentToday();
  budgetRemaining = Math.max(0, BUDGET - spent);
  console.log(`Backfill budget: ${BUDGET} units/day on the ${ON_BACKUP_KEY ? 'backup' : 'main'} key, ${spent} already spent, ${budgetRemaining} available.`);

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

  // A run killed mid-job (track-drain caps the child at 20 minutes) leaves its claim behind
  // and the channel stuck on 'running' forever. Anything claimed over an hour ago is dead.
  const stale = await pool.query(
    `update backfill_jobs set status = 'queued', started_at = null
      where kind = 'catalog' and status = 'running' and started_at < now() - interval '1 hour'
      returning channel_id`
  );
  if (stale.rowCount) {
    await pool.query(
      `update channel_tracking set backfill_status = 'queued' where channel_id = any($1) and backfill_status = 'running'`,
      [stale.rows.map((r) => r.channel_id)]
    );
    console.log(`Reclaimed ${stale.rowCount} stale running jobs.`);
  }

  // A channel somebody is actually watching comes before the corpus catch-up. Without this the
  // user lane queues behind whatever bulk enqueue happens to share the front of the queue —
  // 500 subscriptions imported today sat behind 3,284 legacy jobs, five days out.
  const { rows: jobs } = await pool.query(
    `select j.id, j.channel_id, coalesce(ct.backfill_depth, $2) as depth
       from backfill_jobs j
       left join channel_tracking ct on ct.channel_id = j.channel_id
      where j.kind = 'catalog' and j.status = 'queued'
      order by (ct.lane = 'user') desc nulls last, j.requested_at asc
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
