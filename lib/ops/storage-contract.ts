// The storage contract: every table big enough to matter says how it stays bounded.
//
// 2026-09-26: the Supabase disk auto-expanded 8 → 12 → 18 → 27 GB in about two months, and each
// time the cause was a table nobody had put a number on — a text copy stored twice because its
// clean-up job silently stood down, a history table at its high-water mark after a rescoring
// burst, a readings table whose "daily" retention tier kept one row per video per day for ever.
// None was hard to see. Nothing was looking.
//
// So: a table over CONTRACT_THRESHOLD_MB must be declared here, with a policy, a budget and what
// enforces it. evaluateContracts() fails an undeclared table, an over-budget one, and a heavily
// bloated one; evaluateGrowth() fails a table growing faster than it said it would. The same
// functions back an opt-in DB test (storage-contract.db.test.ts) and the daily guard
// (scripts/storage-guard.ts), which alerts. Everything reads the catalog only.

export type GrowthPolicy =
  /** Old rows are deleted by a retention job; size converges. */
  | 'bounded-retention'
  /** Rows are consumed and deleted; size tracks backlog. */
  | 'queue'
  /** One row per video/channel/…; grows with the corpus. */
  | 'entity'
  /** Rebuildable from other tables; one row per entity. */
  | 'derived-cache'
  /** Grows without bound BY DECISION. Must state its rate; the decision is revisited when it trips. */
  | 'append-forever'
  /** Not written any more. */
  | 'static';

export interface StorageContract {
  /** `relname` for public, `schema.relname` otherwise. */
  table: string;
  policy: GrowthPolicy;
  /** Total size (heap + toast + indexes) above which the contract fails. */
  budgetMb: number;
  /** Sustained growth above which the guard alerts. */
  maxGrowthMbPerDay?: number;
  /** The code or decision that keeps it bounded — or the admission that nothing does yet. */
  enforcedBy: string;
  /** Where the table is expected to settle once pending work lands, if different. */
  targetMb?: number;
}

export const CONTRACT_THRESHOLD_MB = 10;
/** A table this large with more than BLOAT_ALERT_PCT estimated free space is worth a reclaim. */
export const BLOAT_ALERT_MIN_MB = 200;
export const BLOAT_ALERT_PCT = 50;

// Budgets are ceilings we accept today, ~10-20 % over the 2026-09-26 size unless the table is
// known to be wrong (then the budget is what it SHOULD be, and it fails until fixed).
export const STORAGE_CONTRACTS: StorageContract[] = [
  { table: 'videos', policy: 'entity', budgetMb: 4600, maxGrowthMbPerDay: 25, targetMb: 2000,
    enforcedBy: 'grows with ingest (~14 MB/day 09-14..26); ~2 GB of text leaves via null-video-text + pg_repack (runbook 2026-09-26)' },
  { table: 'rss_samples', policy: 'bounded-retention', budgetMb: 3500, maxGrowthMbPerDay: 30,
    enforcedBy: 'scripts/thin-readings.ts tiers (lib/readings/retention.ts). The daily tier has NO end: ~477 K rows/day kept for ever (~120 MB/day). Terminal tier awaiting decision (runbook 2026-09-26 §3)' },
  { table: 'video_text', policy: 'entity', budgetMb: 2600, maxGrowthMbPerDay: 20,
    enforcedBy: 'one row per video, written at ingest (lib/app/video-text.ts videoInsertSql); the text home once videos is cleared' },
  { table: 'video_score_history', policy: 'bounded-retention', budgetMb: 600, maxGrowthMbPerDay: 40, targetMb: 150,
    enforcedBy: '14 days (scripts/thin-readings.ts). Steady ~20 K rows/day ≈ 130 MB; a full rescore adds ~360 MB for 14 days. DELETE-based retention left 1,280 MB at 92.7 % free until pg_repack (1,392 → 98 MB, 2026-09-26); daily partitions make retention a DROP (sql/2026-09-26-partition-video-score-history.sql, awaiting approval)' },
  { table: 'view_snapshots', policy: 'append-forever', budgetMb: 1300, maxGrowthMbPerDay: 15,
    enforcedBy: 'NOTHING. ~33 K rows/day (~10 MB/day); CLAUDE.md promises a monthly cleanup of >1-year rows that does not exist (rows from 2025-06-30 remain)' },
  { table: 'observation_change_log', policy: 'queue', budgetMb: 800,
    enforcedBy: 'scripts/materialize-observations.ts deletes consumed changes (OBS_CHANGES_DELETE_SQL)' },
  { table: 'view_samples', policy: 'bounded-retention', budgetMb: 800, maxGrowthMbPerDay: 20,
    enforcedBy: 'scripts/thin-readings.ts api tiers; daily tier has no end (~100 K rows/day kept)' },
  { table: 'video_obs_cache', policy: 'derived-cache', budgetMb: 650,
    enforcedBy: 'one row per video, rebuilt by the observation materializer' },
  { table: 'feed_events', policy: 'append-forever', budgetMb: 450, maxGrowthMbPerDay: 5,
    enforcedBy: 'NOTHING (dedupe_key keeps it idempotent; rows leave only with their video)' },
  { table: 'video_scores', policy: 'derived-cache', budgetMb: 400,
    enforcedBy: 'one row per video per model_version; old versions must be dropped when a model is retired' },
  { table: 'view_tracking_priority', policy: 'entity', budgetMb: 320, enforcedBy: 'one row per video' },
  { table: 'daily_analytics', policy: 'append-forever', budgetMb: 300, maxGrowthMbPerDay: 3,
    enforcedBy: 'owner-channel analytics per day; deleted per channel on disconnect (lib/app/analytics-privacy.ts)' },
  { table: 'description_versions', policy: 'append-forever', budgetMb: 260, maxGrowthMbPerDay: 3,
    enforcedBy: 'NOTHING: one row per observed description change (scripts/rss-poll.ts)' },
  { table: 'thumbnail_versions', policy: 'entity', budgetMb: 150,
    enforcedBy: 'one row per video thumbnail version; 31 M updates on 212 K rows keep ~10 % free space' },
  { table: 'touch_queue', policy: 'append-forever', budgetMb: 120, maxGrowthMbPerDay: 2,
    enforcedBy: 'processed rows are the dedupe memory for (kind, ref); never deleted by design' },
  { table: 'obs_cache_dirty', policy: 'queue', budgetMb: 120, enforcedBy: 'drained by the observation materializer' },
  { table: 'score_dirty', policy: 'queue', budgetMb: 100, enforcedBy: 'drained by scripts/score-videos.ts' },
  { table: 'chunks', policy: 'static', budgetMb: 60, enforcedBy: 'legacy transcript chunks; not written since 2025-06' },
  { table: 'thumbnail_battle_matchups', policy: 'entity', budgetMb: 80, enforcedBy: 'one row per matchup' },
  { table: 'track_schedule', policy: 'entity', budgetMb: 70, enforcedBy: 'one row per tracked video' },
  { table: 'embeddings_v1', policy: 'entity', budgetMb: 60, enforcedBy: 'one row per embedded video' },
  { table: 'channel_age_adjusted_performance', policy: 'static', budgetMb: 40,
    enforcedBy: 'materialized view, last refreshed 2025-07; candidate to drop' },
  { table: 'video_performance_trends', policy: 'static', budgetMb: 40,
    enforcedBy: 'materialized view, last refreshed 2025-07; candidate to drop' },
  { table: 'cron.job_run_details', policy: 'append-forever', budgetMb: 60, maxGrowthMbPerDay: 1,
    enforcedBy: 'NOTHING: pg_cron keeps every run (~72/day); purge with cron.job_run_details delete when it matters' },
  { table: 'rss_latest', policy: 'derived-cache', budgetMb: 50, enforcedBy: 'one row per video, trigger-maintained from rss_samples' },
  { table: 'youtube_quota_calls', policy: 'bounded-retention', budgetMb: 50, enforcedBy: 'pruned (115 K deleted to date)' },
  { table: 'channels', policy: 'entity', budgetMb: 30, enforcedBy: 'one row per channel' },
  { table: 'video_title_watch', policy: 'entity', budgetMb: 30, enforcedBy: 'one row per watched video' },
  { table: 'video_processing_jobs', policy: 'static', budgetMb: 25, enforcedBy: 'legacy job rows, not written since 2025-08' },
  { table: 'channel_directory', policy: 'entity', budgetMb: 30, enforcedBy: 'one row per channel' },
  { table: 'rss_response_state', policy: 'entity', budgetMb: 30, enforcedBy: 'one row per polled channel' },
  { table: 'channel_discovery', policy: 'entity', budgetMb: 25, enforcedBy: 'one row per discovered channel' },
];

export interface RelationSize {
  name: string;
  kind: string;
  totalBytes: number;
  heapBytes: number;
  toastBytes: number;
  indexBytes: number;
  liveTuples: number;
  deadTuples: number;
  /** Estimated free space in the heap, from pg_stats row widths. Cheap and approximate. */
  estBloatPct: number;
}

export interface StorageSnapshot {
  at: string;
  dbBytes: number;
  /** The Supabase data volume, from the project metrics endpoint; null when unavailable. */
  disk: { sizeBytes: number; availBytes: number } | null;
  relations: RelationSize[];
}

export interface Violation {
  table: string;
  kind: 'undeclared' | 'over-budget' | 'bloat' | 'growth';
  message: string;
}

const MB = 1024 * 1024;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Relation sizes, from the catalog alone. One statement, ≤ 300 rows of ~150 bytes.
 *
 * est_bloat_pct: 1 − (live rows × estimated row width) / heap bytes, where the width is the sum of
 * pg_stats.avg_width plus a 28-byte tuple header and line pointer. It is the classic catalog-only
 * estimate — coarse for tables whose wide columns are TOASTed, but it caught video_score_history
 * (93 % free by pgstattuple_approx, ~93 % by this) without reading a single page.
 */
export const CATALOG_SIZES_SQL = `
  with w as (
    select schemaname, tablename, sum(avg_width)::float8 + 28 as row_bytes
      from pg_stats group by 1, 2
  ),
  -- A partitioned table's own size is 0: its data is in the partitions. Roll each leaf up to its
  -- top-level parent, so video_score_history is one line under one contract however many days
  -- it is split into, and a partition is never reported as an undeclared table of its own.
  sized as (
    select c.oid,
           case when c.relkind = 'p' then
             (select coalesce(sum(pg_total_relation_size(t.relid)), 0) from pg_partition_tree(c.oid) t where t.isleaf)
           else pg_total_relation_size(c.oid) end::float8 as total_bytes,
           case when c.relkind = 'p' then
             (select coalesce(sum(pg_relation_size(t.relid)), 0) from pg_partition_tree(c.oid) t where t.isleaf)
           else pg_relation_size(c.oid) end::float8 as heap_bytes,
           case when c.relkind = 'p' then
             (select coalesce(sum(pg_indexes_size(t.relid)), 0) from pg_partition_tree(c.oid) t where t.isleaf)
           else pg_indexes_size(c.oid) end::float8 as index_bytes
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'm', 'p')
       and not c.relispartition
       and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  )
  select case when n.nspname = 'public' then c.relname else n.nspname || '.' || c.relname end as name,
         c.relkind as kind,
         z.total_bytes,
         z.heap_bytes,
         coalesce(pg_total_relation_size(nullif(c.reltoastrelid, 0)), 0)::float8 as toast_bytes,
         z.index_bytes,
         coalesce(s.n_live_tup, c.reltuples, 0)::float8 as live_tuples,
         coalesce(s.n_dead_tup, 0)::float8 as dead_tuples,
         case when c.relkind <> 'p' and z.heap_bytes > 0 and w.row_bytes is not null
              then greatest(0, 100 * (1 - coalesce(s.n_live_tup, 0) * w.row_bytes / z.heap_bytes))
              else 0 end::float8 as est_bloat_pct
    from sized z
    join pg_class c on c.oid = z.oid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_all_tables s on s.relid = c.oid
    left join w on w.schemaname = n.nspname and w.tablename = c.relname
   where z.total_bytes > 1048576
   order by z.total_bytes desc
   limit 300`;

export function rowToRelation(r: Record<string, unknown>): RelationSize {
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    name: String(r.name), kind: String(r.kind), totalBytes: n('total_bytes'), heapBytes: n('heap_bytes'),
    toastBytes: n('toast_bytes'), indexBytes: n('index_bytes'), liveTuples: n('live_tuples'),
    deadTuples: n('dead_tuples'), estBloatPct: Math.round(n('est_bloat_pct') * 10) / 10,
  };
}

export function evaluateContracts(
  relations: readonly RelationSize[], contracts: readonly StorageContract[] = STORAGE_CONTRACTS,
  thresholdMb = CONTRACT_THRESHOLD_MB,
): Violation[] {
  const byName = new Map(contracts.map((c) => [c.table, c]));
  const out: Violation[] = [];
  for (const r of relations) {
    const mb = r.totalBytes / MB;
    const c = byName.get(r.name);
    if (!c) {
      if (mb > thresholdMb) {
        out.push({ table: r.name, kind: 'undeclared',
          message: `${r.name} is ${fmt(mb)} MB and has no storage contract — declare its policy and budget in lib/ops/storage-contract.ts` });
      }
      continue;
    }
    if (mb > c.budgetMb) {
      out.push({ table: r.name, kind: 'over-budget',
        message: `${r.name} is ${fmt(mb)} MB, over its budget ${fmt(c.budgetMb)} MB (${c.policy}; ${c.enforcedBy})` });
    }
    if (mb > BLOAT_ALERT_MIN_MB && r.estBloatPct > BLOAT_ALERT_PCT) {
      out.push({ table: r.name, kind: 'bloat',
        message: `${r.name}: ~${Math.round(r.estBloatPct)} % of its ${fmt(r.heapBytes / MB)} MB heap is estimated free space — reclaim candidate (scripts/reclaim-table.ts)` });
    }
  }
  return out;
}

/** MB/day per relation between the oldest snapshot inside `days` and the newest. */
export function growthRates(snapshots: readonly StorageSnapshot[], days = 7): Map<string, number> {
  const out = new Map<string, number>();
  if (snapshots.length < 2) return out;
  const sorted = [...snapshots].sort((a, b) => a.at.localeCompare(b.at));
  const last = sorted.at(-1)!;
  const horizon = new Date(last.at).getTime() - days * 86_400_000;
  const first = sorted.find((s) => new Date(s.at).getTime() >= horizon)!;
  const spanDays = (new Date(last.at).getTime() - new Date(first.at).getTime()) / 86_400_000;
  if (spanDays < 0.9) return out;
  const before = new Map(first.relations.map((r) => [r.name, r.totalBytes]));
  for (const r of last.relations) {
    const b = before.get(r.name);
    if (b != null) out.set(r.name, (r.totalBytes - b) / MB / spanDays);
  }
  return out;
}

export function evaluateGrowth(
  rates: ReadonlyMap<string, number>, contracts: readonly StorageContract[] = STORAGE_CONTRACTS,
  currentMb: ReadonlyMap<string, number> = new Map(),
): Violation[] {
  const out: Violation[] = [];
  for (const c of contracts) {
    const rate = rates.get(c.table);
    if (rate == null || c.maxGrowthMbPerDay == null || rate <= c.maxGrowthMbPerDay) continue;
    const now = currentMb.get(c.table);
    const days = now != null && rate > 0 ? (c.budgetMb - now) / rate : null;
    out.push({ table: c.table, kind: 'growth',
      message: `${c.table} is growing ${fmt(rate)} MB/day, over its declared ${c.maxGrowthMbPerDay} MB/day` +
               (days != null ? `; reaches its ${fmt(c.budgetMb)} MB budget in ${days <= 0 ? 'already' : `${Math.round(days)} days`}` : '') });
  }
  return out;
}

export interface DiskProjection {
  usedFraction: number;
  usedMb: number;
  sizeMb: number;
  mbPerDay: number | null;
  /** Days until used/size reaches the threshold at the current rate; null if not growing. */
  daysToThreshold: number | null;
}

/** Where the data volume is heading. Uses the metrics endpoint's view (includes WAL and temp). */
export function projectDisk(snapshots: readonly StorageSnapshot[], threshold = 0.9, days = 7): DiskProjection | null {
  const withDisk = [...snapshots].filter((s) => s.disk).sort((a, b) => a.at.localeCompare(b.at));
  if (!withDisk.length) return null;
  const last = withDisk.at(-1)!;
  const used = (s: StorageSnapshot) => (s.disk!.sizeBytes - s.disk!.availBytes) / MB;
  const sizeMb = last.disk!.sizeBytes / MB;
  const usedMb = used(last);
  const horizon = new Date(last.at).getTime() - days * 86_400_000;
  const first = withDisk.find((s) => new Date(s.at).getTime() >= horizon)!;
  const span = (new Date(last.at).getTime() - new Date(first.at).getTime()) / 86_400_000;
  // A disk resize changes sizeBytes; a rate across it would be meaningless.
  const rate = span >= 0.9 && first.disk!.sizeBytes === last.disk!.sizeBytes ? (usedMb - used(first)) / span : null;
  const room = threshold * sizeMb - usedMb;
  return {
    usedFraction: usedMb / sizeMb, usedMb, sizeMb, mbPerDay: rate,
    daysToThreshold: rate && rate > 0 ? Math.max(0, room / rate) : null,
  };
}
