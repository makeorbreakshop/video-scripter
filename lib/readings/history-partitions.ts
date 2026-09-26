// video_score_history as one partition per UTC day, so retention returns disk by itself.
//
// THE PROBLEM (2026-09-26). The table keeps 14 days (lib/readings/retention.ts historyDays) and
// steady state is ~20 K rows/day, ~130 MB. But a full rescoring pass writes ~800 K rows in a day;
// four of them (2026-09-02..12) pushed the heap to 1,280 MB, and a DELETE never gives space back
// to the filesystem — the file sat at 92.7 % free space until a one-time pg_repack
// (scripts/reclaim-table.ts: 1,392 → 98 MB in 19 s). The next model change would do it again.
//
// THE FIX. Range-partition by scored_at, one partition per UTC day (the archive's unit too:
// history/day=YYYY-MM-DD). Retention becomes DROP TABLE of a day that R2 has verified, so a burst
// occupies disk for exactly the retention window and then leaves. scripts/thin-readings.ts keeps
// a week of partitions ahead and drops expired ones; a DEFAULT partition catches anything that
// arrives without one, and the thin job reports it.
//
// Everything here is SQL construction; partitionMigrationSql() generates the one-time migration
// committed as sql/2026-09-26-partition-video-score-history.sql (a test pins them equal).
import { dayRange, utcDay } from './retention';

export interface HistoryTable {
  schema: string;
  table: string;
  view: string;
  sequence: string;
  /** Grants that Supabase's default privileges do not add on their own. */
  extraGrants: string[];
}

export const HISTORY: HistoryTable = {
  schema: 'public', table: 'video_score_history', view: 'video_scores_by_version',
  sequence: 'video_score_history_id_seq', extraGrants: ['channelsmith_app'],
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const IDENT = /^[a-z_][a-z0-9_]*$/;
function day(d: string): string {
  if (!DAY.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new Error(`not a day: ${d}`);
  return d;
}
function id(s: string): string {
  if (!IDENT.test(s)) throw new Error(`not an identifier: ${s}`);
  return s;
}
const nextDay = (d: string) => utcDay(Date.parse(`${d}T00:00:00Z`) + 86_400_000);

export function partitionName(t: HistoryTable, d: string): string {
  return `${id(t.schema)}.${id(t.table)}_p${day(d).replace(/-/g, '')}`;
}

export function createPartitionSql(t: HistoryTable, d: string): string {
  return `create table if not exists ${partitionName(t, d)}
    partition of ${id(t.schema)}.${id(t.table)}
    for values from ('${d} 00:00:00+00') to ('${nextDay(d)} 00:00:00+00')`;
}

/** Dropping a partition takes ACCESS EXCLUSIVE on the parent briefly; never queue for it. */
export function dropPartitionSql(t: HistoryTable, d: string): string {
  return `begin; set local lock_timeout = '5s'; drop table if exists ${partitionName(t, d)}; commit;`;
}

/** Is the table partitioned yet? Before the migration, retention keeps using DELETE. */
export const HISTORY_PARTITIONED_SQL =
  `select relkind = 'p' as partitioned from pg_class where oid = 'public.video_score_history'::regclass`;

export const LIST_PARTITIONS_SQL = `
  select c.relname
    from pg_inherits i join pg_class c on c.oid = i.inhrelid
   where i.inhparent = 'public.video_score_history'::regclass
   order by c.relname`;

/** Rows in the DEFAULT partition mean a day arrived with no partition — worth a warning. */
export const DEFAULT_PARTITION_ROWS_SQL =
  `select count(*)::int as n from (select 1 from public.video_score_history_default limit 1000) x`;

/** The UTC days named by partition relnames (`<table>_pYYYYMMDD`). */
export function partitionDays(relnames: readonly string[]): string[] {
  const out: string[] = [];
  for (const n of relnames) {
    const m = n.match(/_p(\d{4})(\d{2})(\d{2})$/);
    if (m) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return out.sort();
}

export interface PartitionPlan { create: string[]; drop: string[]; blocked: string[] }

/**
 * What tonight should do. Drops only days at or past the retention cutoff (the same cutoff the
 * DELETE path used: utcDay(now − keepDays)) AND verified in R2; an expired day without a verified
 * archive is `blocked` — disk pressure is preferable to data loss.
 */
export function planPartitions(
  existing: readonly string[], now: Date,
  { keepDays, aheadDays, isArchived }: { keepDays: number; aheadDays: number; isArchived: (d: string) => boolean },
): PartitionPlan {
  const have = new Set(existing);
  const today = utcDay(now);
  const until = utcDay(now.getTime() + aheadDays * 86_400_000);
  const create = dayRange(today, until).filter((d) => !have.has(d));
  const cutoff = utcDay(now.getTime() - keepDays * 86_400_000);
  const expired = existing.filter((d) => d <= cutoff).sort();
  return {
    create,
    drop: expired.filter((d) => isArchived(d)),
    blocked: expired.filter((d) => !isArchived(d)),
  };
}

/** The one-time migration from the plain table to the partitioned one. One transaction. */
export function partitionMigrationSql(t: HistoryTable): string {
  const s = id(t.schema), tb = id(t.table), nx = `${tb}_next`;
  const q = (x: string) => `${s}.${x}`;
  return `
-- Generated by lib/readings/history-partitions.ts partitionMigrationSql(). Do not edit by hand.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '300s';
-- Blocks writers (the scorer) for the copy; readers carry on. Fails in 5 s rather than queueing.
lock table ${q(tb)} in share row exclusive mode;

create table ${q(nx)} (like ${q(tb)} including defaults including constraints including comments)
  partition by range (scored_at);
alter table ${q(nx)} add primary key (id, scored_at);
create index on ${q(nx)} (model_version, scored_at);
create table ${q(nx)}_default partition of ${q(nx)} default;

do $$
declare d date; last date := (now() at time zone 'utc')::date + 7;
begin
  select coalesce(min((scored_at at time zone 'utc')::date), (now() at time zone 'utc')::date)
    into d from ${q(tb)};
  while d <= last loop
    execute format('create table %I.%I partition of %I.%I for values from (%L) to (%L)',
      '${s}', '${tb}_p' || to_char(d, 'YYYYMMDD'), '${s}', '${nx}',
      to_char(d, 'YYYY-MM-DD') || ' 00:00:00+00', to_char(d + 1, 'YYYY-MM-DD') || ' 00:00:00+00');
    d := d + 1;
  end loop;
end $$;

insert into ${q(nx)} select * from ${q(tb)};

do $$
begin
  if (select count(*) from ${q(nx)}) <> (select count(*) from ${q(tb)}) then
    raise exception 'row count mismatch; nothing changed';
  end if;
  if exists (select 1 from ${q(nx)}_default) then
    raise exception 'rows landed in the default partition; nothing changed';
  end if;
end $$;

alter sequence ${q(id(t.sequence))} owned by ${q(nx)}.id;
alter table ${q(tb)} rename to ${tb}_unpartitioned;
alter table ${q(nx)} rename to ${tb};
alter table ${q(nx)}_default rename to ${tb}_default;
${t.extraGrants.map((g) => `grant all on ${q(tb)} to ${id(g)};`).join('\n')}

-- The view follows the OLD table's oid through the rename; point it at the new one.
create or replace view ${q(id(t.view))} as
  select distinct on (h.video_id, h.model_version) h.id, h.video_id, h.channel_id, h.model_version,
         h.scored_at, h.age_days, h.views, h.score, h.same_age_ratio, h.typical_at_age, h.n_typical,
         h.typical_measured_share, h.projection, h.projection_horizon, h.est30, h.baseline,
         h.n_baseline, h.confidence, h.extra
    from ${q(tb)} h
   order by h.video_id, h.model_version, h.scored_at desc;
commit;
`;
}
