// Build the per-video series files on R2 (lib/readings/series.ts).
//
// Two modes, one code path:
//   drain    — the videos scripts/rss-poll.ts, launch-track.ts and the ingest paths marked dirty
//              since the last run. This is the steady state: one R2 PUT per video that moved,
//              however many readings landed on it.
//   repair   — a named/channel set, or an explicitly bounded sample of all tracked videos.
//
// With --with-archive the file also carries the readings that Postgres has already thinned away,
// read back out of the day-partitioned parquet archive. Without it the file is exactly what
// Postgres holds, which is what the equality test compares against.
//
// Usage:
//   npx tsx scripts/rebuild-series.ts --drain --limit 2000
//   npx tsx scripts/rebuild-series.ts --videos abc123,def456 --with-archive
//   npx tsx scripts/rebuild-series.ts --channel UC... --limit 200
//   npx tsx scripts/rebuild-series.ts --all --limit 500          # limit is mandatory
//   npx tsx scripts/rebuild-series.ts --drain --dry-run
//
// Routine drains never read raw observation history from Postgres. They read the compact v2
// projection produced by materialize-observations.ts, plus the small metadata tables needed by
// the chart. Existing R2 files are merged back in so already-archived history is retained.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { makeTimedPool } from '../lib/admin/db';
import { SupabaseQueryTracer, supabaseApplicationName } from '../lib/admin/supabase-trace';
import { buildSeriesFile, mergeSeriesFiles, type VideoSeriesFile } from '../lib/readings/series';
import {
  SERIES_SQL, SERIES_DIRTY_DDL, SERIES_DIRTY_CLAIM_SQL, SERIES_DIRTY_CLEAR_SQL,
  SERIES_DIRTY_COUNT_SQL, readSeriesFile, writeSeriesFile,
} from '../lib/readings/series-store';
import { r2Config, MISSING_CREDENTIALS, rawReadings } from '../lib/readings/archive';
import { OBS_CACHE_SERIES_READ_SQL } from '../lib/scoring/obs-cache';
import { decodeObservationState, seriesInputFromObservationState } from '../lib/scoring/observation-state';
import { startManagedJob } from '../lib/nightly/job-lifecycle';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const arg = (f: string): string | undefined => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

const drain = has('--drain');
const all = has('--all');
const dry = has('--dry-run') || has('--dry');
const withArchive = has('--with-archive');
const channel = arg('--channel');
const only = (arg('--videos') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const explicitLimit = Number(arg('--limit') ?? 0);
if (all && !(explicitLimit > 0)) throw new Error('--all requires an explicit positive --limit');
const limit = explicitLimit || (drain ? 2000 : 500);
/** Videos per chunk of reads. Each chunk is four bounded index reads. */
const CHUNK = Number(arg('--chunk') ?? 0) || 50;
/**
 * R2 PUTs in flight at once. The database sees no extra load from this — the chunk's reads are
 * already done — and serially the job is bound by object-store round trips: 200 videos took 85 s
 * at 1, which would be five days for the whole corpus.
 */
const CONCURRENCY = Number(arg('--concurrency') ?? 0) || 8;
const MAX_SERIES_CACHE_BYTES = 25_000_000;
const maxCacheBytes = Number(arg('--max-cache-bytes') ?? MAX_SERIES_CACHE_BYTES);
if (!Number.isInteger(maxCacheBytes) || maxCacheBytes <= 0 || maxCacheBytes > MAX_SERIES_CACHE_BYTES) {
  throw new Error(`--max-cache-bytes must be an integer from 1 to ${MAX_SERIES_CACHE_BYTES}`);
}
const job = dry
  ? { acquired: true as const, signal: new AbortController().signal, finish: () => {} }
  : startManagedJob({ name: 'series-rebuild', args });
if (!job.acquired) process.exit(0);
const trace = new SupabaseQueryTracer('series-drain');
const cfg = r2Config();
if (!cfg && !dry) {
  console.error(MISSING_CREDENTIALS);
  trace.markFailed();
  trace.finish({ missing_r2_credentials: true });
  job.finish();
  process.exit(1);
}

const pool = makeTimedPool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  timeoutMs: Number(arg('--timeout-ms') ?? 60_000),
  application_name: supabaseApplicationName('series-drain'),
});
const q = async <T = any>(sql: string, params: any[] = []): Promise<T[]> =>
  (await trace.query(pool, sql, params)).rows as T[];

/** Refuse to add load to a database that is already busy. Same preflight as weekly-refit.ts. */
async function busyReason(): Promise<string | null> {
  const rows = await q<{ n: string }>(
    `select count(*)::text as n from pg_stat_activity
      where state = 'active' and now() - query_start > interval '2 minutes'
        and query not ilike '%pg_stat_activity%'`);
  const n = Number(rows[0]?.n ?? 0);
  return n > 0 ? `${n} query(s) have been running over two minutes` : null;
}

interface SeriesTarget { video_id: string; generation?: number }

async function videoTargets(): Promise<SeriesTarget[]> {
  if (only.length) return only.map((video_id) => ({ video_id }));
  if (drain) return (await q<{ video_id: string; generation: string | number }>(SERIES_DIRTY_CLAIM_SQL, [limit || 2000]))
    .map((row) => ({ video_id: row.video_id, generation: Number(row.generation) }));
  if (channel) {
    return (await q<{ id: string }>(
      `select id from videos where channel_id = $1 order by published_at desc ${limit ? 'limit ' + limit : ''}`,
      [channel])).map((row) => ({ video_id: row.id }));
  }
  if (all) {
    // Index-backed and bounded: the tracking table is the set of videos that have readings at
    // all, and is two orders of magnitude smaller than a scan of `videos`.
    return (await q<{ video_id: string }>(
      `select video_id from view_tracking_priority order by video_id ${limit ? 'limit ' + limit : ''}`));
  }
  throw new Error('nothing to do: pass --drain, --all, --channel <id> or --videos a,b,c');
}

/** One chunk of videos -> one series file each, built from the compact v2 projection. */
async function buildChunk(ids: string[], remainingCacheBytes: number): Promise<{
  files: Map<string, VideoSeriesFile>;
  cacheBytes: number;
  budgetExceeded: boolean;
}> {
  const cacheRows = await q<{
    video_id: string | null; obs: Buffer | null; format: number | null;
    last_change_id: string | number | null; total_cache_bytes: string | number;
  }>(
    OBS_CACHE_SERIES_READ_SQL, [ids, remainingCacheBytes],
  );
  const cacheBytes = Number(cacheRows[0]?.total_cache_bytes ?? 0);
  if (cacheRows.some((row) => row.video_id == null)) {
    return { files: new Map(), cacheBytes, budgetExceeded: true };
  }
  const cached = cacheRows;
  const [videos, thumbs, titles] = await Promise.all([
    q(SERIES_SQL.video, [ids]),
    q(SERIES_SQL.thumbs, [ids]),
    q(SERIES_SQL.titles, [ids]),
  ]);
  const bucket = <T extends { video_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) (m.get(r.video_id) ?? m.set(r.video_id, []).get(r.video_id)!).push(r);
    return m;
  };
  const [bt, bl] = [bucket(thumbs), bucket(titles)];
  const pub = new Map(videos.map((v: any) => [v.id, v.published_at]));
  const states = new Map<string, ReturnType<typeof decodeObservationState>>();
  for (const row of cached as Array<{ video_id: string; format: number; obs: Buffer }>) {
    if (Number(row.format) !== 2) continue;
    try { states.set(row.video_id, decodeObservationState(row.obs)); }
    catch (error) { console.warn(`[series] unreadable observation state video=${row.video_id}: ${(error as Error).message}`); }
  }
  const out = new Map<string, VideoSeriesFile>();
  for (const id of ids) {
    const state = states.get(id);
    if (!state) continue;
    out.set(id, buildSeriesFile({
      videoId: id, publishedAt: pub.get(id) ?? state.publishedAt,
      ...seriesInputFromObservationState(state),
      thumbs: bt.get(id) ?? [], titles: bl.get(id) ?? [],
    }));
  }
  return { files: out, cacheBytes, budgetExceeded: false };
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

let written = 0, bytes = 0, empty = 0, skipped = 0, cacheReadBytes = 0;
try {
  const busy = await busyReason();
  if (busy && !dry && !has('--force')) {
    console.error(`refusing to run: ${busy} (--force to override, only for a small supervised run)`);
    trace.markFailed();
    process.exitCode = 2;
  } else {
    await q(SERIES_DIRTY_DDL);
    const pending = Number((await q<{ n: string }>(SERIES_DIRTY_COUNT_SQL))[0]?.n ?? 0);
    const targets = await videoTargets();
    const ids = targets.map((target) => target.video_id);
    const targetById = new Map(targets.map((target) => [target.video_id, target]));
    console.log(`series rebuild: ${ids.length} video(s)${drain ? ` (queue depth ${pending})` : ''}${withArchive ? ' +archive' : ''}${dry ? ' [dry run]' : ''}`);

    const t0 = Date.now();
    for (let i = 0; i < ids.length && !job.signal.aborted; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const built = await buildChunk(chunk, maxCacheBytes - cacheReadBytes);
      if (built.budgetExceeded) {
        console.warn(`series drain stopped before a ${built.cacheBytes}-byte cache chunk exceeded the ${maxCacheBytes}-byte run budget`);
        break;
      }
      cacheReadBytes += built.cacheBytes;
      const files = built.files;
      const done: Array<{ video_id: string; generation: number }> = [];
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunk.length) }, async () => {
        for (;;) {
          if (job.signal.aborted) return;
          const id = chunk[cursor++];
          if (id === undefined) return;
          const current = files.get(id);
          if (!current) { skipped++; continue; }
          const previous = cfg ? await readSeriesFile(id, cfg) : null;
          let file = previous ? mergeSeriesFiles(previous, current) : current;
          file = await withArchived(file);
          const target = targetById.get(id);
          if (drain && target?.generation !== undefined) {
            done.push({ video_id: id, generation: target.generation });
          }
          if (!file.snapshots.length && !file.samples.length && !file.rss.length) { empty++; continue; }
          if (!dry) bytes += (await writeSeriesFile(file, cfg)).bytes;
          written++;
        }
      }));
      if (drain && !dry && done.length) await q(SERIES_DIRTY_CLEAR_SQL, [JSON.stringify(done)]);
      if ((i / CHUNK) % 10 === 0) console.log(`  ${Math.min(i + CHUNK, ids.length)}/${ids.length} · ${written} written · ${(bytes / 1e6).toFixed(1)} MB`);
    }

    console.log(`done: ${written} file(s), ${(bytes / 1e6).toFixed(2)} MB, ${empty} video(s) with no readings, ${skipped} awaiting v2 state, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`mean ${written ? Math.round(bytes / written) : 0} bytes/file`);
  }
} catch (error) {
  trace.markFailed();
  throw error;
} finally {
  await pool.end();
  trace.finish({ files_written: written, r2_bytes: bytes, cache_read_bytes: cacheReadBytes, skipped });
  job.finish();
}
