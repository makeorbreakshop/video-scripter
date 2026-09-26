// The DATABASE half of the video-text ratchet.
//
// lib/app/video-text-access.test.ts scans code. But a column can also be read by the database
// itself — a function behind supabase.rpc(), a view, a materialized view — and none of those are
// in a .ts file. Found 2026-09-26: `competitor_youtube_channels`, the matview live ingest uses to
// decide which channels are tracked (lib/nightly/priority-lane.ts, scripts/nightly-ingest.ts),
// derives every channel id from videos.metadata. Null the column and refresh that matview and the
// tracked-channel set goes empty — with every code-level check green.
//
// This test lists every function, view and matview in `public` whose definition names `videos`
// and a moved column, and fails when the catalog and the declared list below disagree, or when a
// CLEARED column still has a LIVE database reader.
//
// Opt-in (reads the production catalog, ~10 small rows):
//   ALLOW_PRODUCTION_INTEGRATION_TESTS=1 npx jest --testPathIgnorePatterns /node_modules/ -- lib/app/video-text-db-objects.db.test.ts
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { CLEARED_COLUMNS, TEXT_COLUMNS, type TextColumn } from './video-text-move';
import { readsFromVideos } from './video-text-db-readers';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const DSN = process.env.DATABASE_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;

type Status =
  /** Called by live code; clearing the column breaks it. Blocks the column. */
  | 'live'
  /** No caller outside one-off scripts under scripts/*.js. Does not block. */
  | 'dead'
  /** A materialized view that is never refreshed; its stored rows do not change when the column is cleared. */
  | 'stale-matview';

interface DbReader { name: string; kind: 'function' | 'view' | 'matview'; columns: TextColumn[]; status: Status; note: string }

export const DB_READERS: DbReader[] = [
  { name: 'batch_update_llm_summaries', kind: 'function', columns: ['llm_summary'], status: 'dead', note: 'writer; no caller in app/lib/scripts' },
  { name: 'batch_update_videos_llm_summary', kind: 'function', columns: ['llm_summary'], status: 'dead', note: 'writer; no caller' },
  { name: 'get_random_outlier_videos', kind: 'function', columns: ['llm_summary'], status: 'dead', note: 'no caller' },
  { name: 'llm_summary_status', kind: 'view', columns: ['description', 'llm_summary'], status: 'dead', note: 'scripts/sync-summary-embeddings.js only' },
  { name: 'database_data_quality', kind: 'matview', columns: ['llm_summary'], status: 'stale-matview', note: 'dashboard stats; not refreshed by any job' },
  { name: 'heistable_videos', kind: 'matview', columns: ['llm_summary'], status: 'stale-matview', note: 'legacy-baselines scripts; cron 16 inactive' },
  { name: 'get_competitor_channel_stats', kind: 'function', columns: ['metadata'], status: 'live', note: 'app/api/youtube/competitor-channels' },
  { name: 'get_random_video_ids', kind: 'function', columns: ['metadata'], status: 'live', note: 'app/api/idea-radar (category filter)' },
  { name: 'get_youtube_channel_ids', kind: 'function', columns: ['metadata'], status: 'dead', note: 'scripts/migration/backfill-youtube-channel-ids.js only' },
  { name: 'analytics_stats', kind: 'matview', columns: ['metadata'], status: 'live', note: 'database-stats dashboard; refreshed on demand' },
  { name: 'database_channel_health', kind: 'matview', columns: ['metadata'], status: 'live', note: 'database-stats dashboard' },
  { name: 'competitor_channel_summary', kind: 'matview', columns: ['metadata'], status: 'live', note: 'refresh-competitor-view route' },
  { name: 'competitor_youtube_channels', kind: 'matview', columns: ['metadata'], status: 'live', note: 'LIVE INGEST tracked-channel set (priority-lane, nightly-ingest, drain-touch-queue, extension-api). Last refreshed ~2025-07-31 (818 rows); a refresh after metadata is cleared would empty it' },
];

const CATALOG_SQL = `
  select p.proname as name, 'function' as kind, p.prosrc as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select viewname, 'view', definition from pg_views where schemaname = 'public'
  union all
  select matviewname, 'matview', definition from pg_matviews where schemaname = 'public'`;

maybe('database objects that read the moved text columns', () => {
  let found: { name: string; kind: string; columns: TextColumn[] }[] = [];
  beforeAll(async () => {
    const pool = new pg.Pool({ connectionString: DSN, max: 1 });
    try {
      const c = await pool.connect();
      try {
        await c.query('begin read only');
        await c.query(`set local statement_timeout = '20s'`);
        // Only candidate objects come back (~13 definitions, a few KB each).
        const rows = (await c.query(
          `select name, kind, def from (${CATALOG_SQL}) d
            where def ~* '\\mvideos\\M' and def ~* '\\m(${TEXT_COLUMNS.join('|')})\\M'`)).rows;
        await c.query('commit');
        found = rows
          .map((r) => ({ name: r.name, kind: r.kind, columns: TEXT_COLUMNS.filter((col) => readsFromVideos(r.def, col)) }))
          .filter((r) => r.columns.length);
      } finally { c.release(); }
    } finally { await pool.end(); }
  }, 60_000);

  it('the declared list matches the catalog exactly — a new database reader must be declared', () => {
    const key = (x: { name: string; kind: string; columns: string[] }) => `${x.kind}:${x.name}:${[...x.columns].sort().join('+')}`;
    expect(found.map(key).sort()).toEqual(DB_READERS.map(key).sort());
  });

  it('no CLEARED column has a live database reader', () => {
    const live = DB_READERS.filter((r) => r.status === 'live' && r.columns.some((c) => CLEARED_COLUMNS.includes(c)));
    expect(live).toEqual([]);
  });
});
