// Backfill channel_meta (avatar, title, counts) for every channel a user tracks or
// that we discovered, using channels.list with up to 50 ids per call — 1 YouTube unit
// per call, not per channel. Units are logged to quota_ledger as 'channel-meta'.
//
// Direct Postgres only — never supabase-js (2026-08-31 org-wide egress incident).
// Idempotent: rows are upserted, and a channel already fetched inside --max-age days
// is skipped, so re-running costs nothing.
//
// Usage:
//   npx tsx scripts/channel-meta-backfill.ts --dry
//   npx tsx scripts/channel-meta-backfill.ts                 # every missing channel
//   npx tsx scripts/channel-meta-backfill.ts --tracked-only  # only user_channels
//   npx tsx scripts/channel-meta-backfill.ts --max-age 30    # also refresh stale rows
//   npx tsx scripts/channel-meta-backfill.ts --limit 500 --sleep 400
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';

const YT = 'https://www.googleapis.com/youtube/v3';
const BATCH = 50;           // channels.list caps id lists at 50 — 1 unit per call
const DEFAULT_SLEEP_MS = 300;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] ?? '' : null;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const num = (name: string, fallback: number) => {
  const v = parseInt(arg(name) || '', 10);
  return Number.isFinite(v) ? v : fallback;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> =>
  (await pool.query(sql, params)).rows as T[];

function pickAvatar(thumbs: any): string | null {
  for (const size of ['high', 'medium', 'default']) {
    const url = thumbs?.[size]?.url;
    if (url) return url;
  }
  return null;
}

function int(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

/** Which channels still need meta. */
async function targets(trackedOnly: boolean, maxAgeDays: number | null, limit: number): Promise<string[]> {
  const sources = trackedOnly
    ? `select channel_id from user_channels`
    : `select channel_id from user_channels
       union
       select channel_id from discovered_channels`;
  // No row at all, or a row older than --max-age.
  const staleClause = maxAgeDays == null
    ? `cm.channel_id is null`
    : `cm.channel_id is null or cm.fetched_at < now() - ($1 || ' days')::interval`;
  const params: any[] = maxAgeDays == null ? [] : [String(maxAgeDays)];
  params.push(limit);
  const rows = await q<{ channel_id: string }>(
    `with src as (${sources})
     select distinct src.channel_id
       from src
       left join channel_meta cm on cm.channel_id = src.channel_id
      where src.channel_id like 'UC%'
        and (${staleClause})
      order by src.channel_id
      limit $${params.length}`,
    params
  );
  return rows.map((r) => r.channel_id);
}

async function logQuota(units: number) {
  if (units <= 0) return;
  await q(`insert into quota_ledger (category, units) values ('channel-meta', $1)`, [units]).catch(() => {});
  await q(
    `insert into youtube_quota_usage (date, quota_used) values (current_date, $1)
     on conflict (date) do update set quota_used = youtube_quota_usage.quota_used + $1`,
    [units]
  ).catch(() => {});
}

async function fetchBatch(ids: string[]): Promise<any[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error('YOUTUBE_API_KEY is not set');
  const url = `${YT}/channels?part=snippet,statistics&id=${ids.join(',')}&key=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`channels.list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return body.items || [];
}

async function save(items: any[]): Promise<number> {
  let n = 0;
  for (const item of items) {
    if (!item?.id) continue;
    await q(
      `insert into channel_meta (channel_id, title, avatar_url, subscriber_count, video_count, fetched_at)
       values ($1,$2,$3,$4,$5, now())
       on conflict (channel_id) do update
         set title = coalesce(excluded.title, channel_meta.title),
             avatar_url = coalesce(excluded.avatar_url, channel_meta.avatar_url),
             subscriber_count = coalesce(excluded.subscriber_count, channel_meta.subscriber_count),
             video_count = coalesce(excluded.video_count, channel_meta.video_count),
             fetched_at = now()`,
      [
        item.id,
        item.snippet?.title ?? null,
        pickAvatar(item.snippet?.thumbnails),
        int(item.statistics?.subscriberCount),
        int(item.statistics?.videoCount),
      ]
    );
    n++;
  }
  return n;
}

async function main() {
  const dry = flag('dry');
  const trackedOnly = flag('tracked-only');
  const maxAge = arg('max-age') != null ? num('max-age', 30) : null;
  const limit = num('limit', 5000);
  const sleepMs = num('sleep', DEFAULT_SLEEP_MS);

  const ids = await targets(trackedOnly, maxAge, limit);
  const calls = Math.ceil(ids.length / BATCH);
  console.log(`${ids.length} channel${ids.length === 1 ? '' : 's'} need meta -> ${calls} call${calls === 1 ? '' : 's'} (${calls} unit${calls === 1 ? '' : 's'})`);
  if (dry || !ids.length) {
    if (dry) console.log(ids.slice(0, 20).join('\n'));
    await pool.end();
    return;
  }

  let saved = 0;
  let units = 0;
  let missing = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const group = ids.slice(i, i + BATCH);
    try {
      const items = await fetchBatch(group);
      units += 1;
      saved += await save(items);
      missing += group.length - items.length; // deleted/private channels come back empty
    } catch (e: any) {
      console.error(`batch ${i / BATCH + 1}: ${e.message}`);
      if (/\b(403|429)\b/.test(e.message)) break; // quota — stop rather than burn retries
    }
    if (i + BATCH < ids.length) await sleep(sleepMs);
  }
  await logQuota(units);
  console.log(`saved ${saved}, ${missing} not returned by YouTube, ${units} unit${units === 1 ? '' : 's'} spent`);
  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
