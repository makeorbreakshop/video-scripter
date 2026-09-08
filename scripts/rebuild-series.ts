// Build the per-video series files on R2 (lib/readings/series.ts).
//
// Two modes, one code path:
//   drain    — the videos scripts/rss-poll.ts, launch-track.ts and the ingest paths marked dirty
//              since the last run. This is the steady state: one R2 PUT per video that moved,
//              however many readings landed on it.
//   backfill — a named set of videos, or every video with readings, oldest first. The full run
//              belongs in the nightly slot (launchd/com.mfm.video-scripter-rebuild-series.plist);
//              during the day use --limit and keep it small.
//
// With --with-archive the file also carries the readings that Postgres has already thinned away,
// read back out of the day-partitioned parquet archive. Without it the file is exactly what
// Postgres holds, which is what the equality test compares against.
//
// Usage:
//   npx tsx scripts/rebuild-series.ts --drain --limit 2000
//   npx tsx scripts/rebuild-series.ts --videos abc123,def456 --with-archive
//   npx tsx scripts/rebuild-series.ts --channel UC... --limit 200
//   npx tsx scripts/rebuild-series.ts --all --limit 500          # nightly: drop --limit
//   npx tsx scripts/rebuild-series.ts --drain --dry-run
//
// Direct Postgres only, one pooled connection, a real statement_timeout, and never two heavy
// reads at once: the video set is walked in chunks and each chunk is five bounded index reads.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { buildSeriesFile, mergeSeriesFiles, type VideoSeriesFile } from '../lib/readings/series';
import {
  SERIES_SQL, SERIES_DIRTY_DDL, SERIES_DIRTY_CLAIM_SQL, SERIES_DIRTY_CLEAR_SQL,
  SERIES_DIRTY_COUNT_SQL, writeSeriesFile,
} from '../lib/readings/series-store';
import { r2Config, MISSING_CREDENTIALS, rawReadings } from '../lib/readings/archive';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string): string | undefined => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const drain = has('--drain');
const all = has('--all');
const dry = has('--dry-run') || has('--dry');
const withArchive = has('--with-archive');
const channel = arg('--channel');
const only = (arg('--videos') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const limit = Number(arg('--limit') ?? 0) || (drain ? 2000 : all ? 0 : 500);
/** Videos per chunk of reads. Small on purpose: five index reads per chunk, one chunk at a time. */
const CHUNK = Number(arg('--chunk') ?? 0) || 50;
/**
 * R2 PUTs in flight at once. The database sees no extra load from this — the chunk's reads are
 * already done — and serially the job is bound by object-store round trips: 200 videos took 85 s
 * at 1, which would be five days for the whole corpus.
 */
const CONCURRENCY = Number(arg('--concurrency') ?? 0) || 8;

const cfg = r2Config();
if (!cfg && !dry) { console.error(MISSING_CREDENTIALS); process.exit(1); }

const pool = makeTimedPool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  timeoutMs: Number(arg('--timeout-ms') ?? 60_000),
});
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> => (await pool.query(sql, params)).rows as T[];

/** Refuse to add load to a database that is already busy. Same preflight as weekly-refit.ts. */
async function busyReason(): Promise<string | null> {
  const rows = await q<{ n: string }>(
    `select count(*)::text as n from pg_stat_activity
      where state = 'active' and now() - query_start > interval '2 minutes'
        and query not ilike '%pg_stat_activity%'`);
  const n = Number(rows[0]?.n ?? 0);
  return n > 0 ? `${n} query(s) have been running over two minutes` : null;
}

async function videoIds(): Promise<string[]> {
  if (only.length) return only;
  if (drain) return (await q<{ video_id: string }>(SERIES_DIRTY_CLAIM_SQL, [limit || 2000])).map((r) => r.video_id);
  if (channel) {
    return (await q<{ id: string }>(
      `select id from videos where channel_id = $1 order by published_at desc ${limit ? 'limit ' + limit : ''}`,
      [channel])).map((r) => r.id);
  }
  if (all) {
    // Index-backed and bounded: the tracking table is the set of videos that have readings at
    // all, and is two orders of magnitude smaller than a scan of `videos`.
    return (await q<{ video_id: string }>(
      `select video_id from view_tracking_priority order by video_id ${limit ? 'limit ' + limit : ''}`)).map((r) => r.video_id);
  }
  throw new Error('nothing to do: pass --drain, --all, --channel <id> or --videos a,b,c');
}

/** One chunk of videos -> one series file each, built from Postgres. */
async function buildChunk(ids: string[]): Promise<Map<string, VideoSeriesFile>> {
  const [videos, snapshots, samples, rss, thumbs, titles] = [
    await q(SERIES_SQL.video, [ids]),
    await q(SERIES_SQL.snapshots, [ids]),
    await q(SERIES_SQL.samples, [ids]),
    await q(SERIES_SQL.rss, [ids]),
    await q(SERIES_SQL.thumbs, [ids]),
    await q(SERIES_SQL.titles, [ids]),
  ];
  const bucket = <T extends { video_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r.video_id) ?? m.set(r.video_id, []).get(r.video_id)!).push(r);
    return m;
  };
  const [bs, ba, br, bt, bl] = [bucket(snapshots), bucket(samples), bucket(rss), bucket(thumbs), bucket(titles)];
  const pub = new Map(videos.map((v: any) => [v.id, v.published_at]));
  const out = new Map<string, VideoSeriesFile>();
  for (const id of ids) {
    out.set(id, buildSeriesFile({
      videoId: id, publishedAt: pub.get(id) ?? null,
      snapshots: bs.get(id) ?? [], samples: ba.get(id) ?? [], rss: br.get(id) ?? [],
      thumbs: bt.get(id) ?? [], titles: bl.get(id) ?? [],
    }));
  }
  return out;
}

/** The readings Postgres has already thinned away, from the parquet archive. */
async function withArchived(file: VideoSeriesFile): Promise<VideoSeriesFile> {
  if (!withArchive || !cfg || !file.published_at) return file;
  const rows = await rawReadings(file.video_id, file.published_at, new Date(), ['rss', 'api'], cfg);
  if (!rows.length) return file;
  const archived = buildSeriesFile({
    videoId: file.video_id, publishedAt: file.published_at, builtAt: file.built_at,
    samples: rows.filter((r) => r.source === 'api').map((r) => ({ at: r.at, views: r.views })),
    rss: rows.filter((r) => r.source === 'rss').map((r) => ({ at: r.at, views: r.views, time_basis: r.time_basis })),
  });
  // Postgres wins on the overlap: it carries the model_eligible/conflicted flags the archive
  // does not, and the two agree on views wherever both hold a reading.
  return mergeSeriesFiles(archived, file);
}

const busy = await busyReason();
if (busy && !dry) { console.error(`refusing to run: ${busy}`); await pool.end(); process.exit(2); }

await pool.query(SERIES_DIRTY_DDL);
const pending = Number((await q<{ n: string }>(SERIES_DIRTY_COUNT_SQL))[0]?.n ?? 0);
const ids = await videoIds();
console.log(`series rebuild: ${ids.length} video(s)${drain ? ` (queue depth ${pending})` : ''}${withArchive ? ' +archive' : ''}${dry ? ' [dry run]' : ''}`);

let written = 0, bytes = 0, empty = 0;
const t0 = Date.now();
for (let i = 0; i < ids.length; i += CHUNK) {
  const chunk = ids.slice(i, i + CHUNK);
  const files = await buildChunk(chunk);
  const done: string[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunk.length) }, async () => {
    for (;;) {
      const id = chunk[cursor++];
      if (id === undefined) return;
      const file = await withArchived(files.get(id)!);
      done.push(id);
      if (!file.snapshots.length && !file.samples.length && !file.rss.length) { empty++; continue; }
      if (!dry) bytes += (await writeSeriesFile(file, cfg)).bytes;
      written++;
    }
  }));
  if (drain && !dry && done.length) await pool.query(SERIES_DIRTY_CLEAR_SQL, [done]);
  if ((i / CHUNK) % 10 === 0) console.log(`  ${Math.min(i + CHUNK, ids.length)}/${ids.length} · ${written} written · ${(bytes / 1e6).toFixed(1)} MB`);
}

console.log(`done: ${written} file(s), ${(bytes / 1e6).toFixed(2)} MB, ${empty} video(s) with no readings, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`mean ${written ? Math.round(bytes / written) : 0} bytes/file`);
await pool.end();
