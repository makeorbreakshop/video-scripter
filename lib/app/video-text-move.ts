// The SQL that moves videos.description / metadata / llm_summary into video_text, and the SQL
// that later clears the originals. Pure strings; scripts/move-video-text.ts and
// scripts/null-video-text.ts own the pool and the throttling.
//
// These three columns are 86 % of a `videos` row (measured 2026-09-08: description 1,038 bytes,
// metadata 742, llm_summary 210, whole row 2,065), and `videos` is 3,984 MB against a 512 MB
// buffer pool — so every page that joins the table pays for bytes it never renders.
//
// THE DEFECT THIS MODULE EXISTS TO PIN (2026-09-09..14): the mover resumed from
// `select max(video_id) from video_text`. A mirror trigger inserts every newly ingested video
// into video_text as it arrives, so that max was always a fresh id near the top of the key
// space. The walk started there, found nothing above it, and declared itself done after 19,659
// of 1,107,961 rows — every night for six nights.
//
// The fix is not a better cursor. It is to stop asking the destination where to resume: walk
// `videos` in primary-key order and anti-join what `video_text` already holds. The cursor is
// then just a keyset over `videos`, and the anti-join makes the whole thing idempotent and
// restartable from anywhere — including from '' — regardless of what the trigger did.
//
// 2026-09-26: every statement is now a bounded WINDOW of primary keys (moveWindowSql,
// nullWindowSql), and the null-out has no corpus-wide gate. Both defects are described where
// the SQL is built.

/** The columns that move. Exactly these three; the list is asserted in the test. */
export const TEXT_COLUMNS = ['description', 'metadata', 'llm_summary'] as const;
export type TextColumn = (typeof TEXT_COLUMNS)[number];

/**
 * Which moved columns have no direct readers left, and may therefore be cleared on `videos` and
 * written only to video_text. ONE list, read by the null-out (scripts/null-video-text.ts), by the
 * ingest writers (lib/ingest/video-insert.ts) and by the ratchet (video-text-access.test.ts).
 * A column joins it only when lib/app/video-text-access.test.ts says it has no readers left.
 */
export const CLEARED_COLUMNS: readonly TextColumn[] = ['llm_summary'];

/** Reject anything that is not one of the three, and reject an empty list. */
function checkColumns(cols: readonly TextColumn[]): readonly TextColumn[] {
  if (!cols.length) throw new Error('null-out needs at least one column');
  for (const c of cols) {
    if (!(TEXT_COLUMNS as readonly string[]).includes(c)) {
      throw new Error(`${c} is not one of the moved columns (${TEXT_COLUMNS.join(', ')})`);
    }
  }
  return cols;
}

/**
 * The next window of primary keys. Every statement below starts from this, so its cost is
 * bounded by $2 however sparse the actual work has become.
 *
 * 2026-09-15..26: the previous form, `where v.id > $1 and not exists (…) order by v.id limit
 * 2000`, had to walk the whole primary key to find 2,000 unmoved rows once only ~5,000 of
 * 1.17 M were left — the 120 s statement timeout killed it (57014). A window cannot do that.
 */
const WINDOW = `win as materialized (select id from videos where id > $1 order by id limit $2)`;

/**
 * One window of the move. $1 = cursor ('' to start), $2 = window size.
 * Returns one row: next_cursor (null once the window is empty), scanned, moved, bytes.
 *
 * `not exists (… video_text …)` is the correctness guarantee; the window is only the cost bound.
 * The anti-join runs on the window's keys alone (index-only on both primary keys) BEFORE any
 * `videos` heap row is fetched: fetching first cost 2.6 s per 5,000-key window (EXPLAIN ANALYZE,
 * 2026-09-26) to find 16-25 unmoved rows in it.
 * `on conflict do nothing`: a side row that appeared since the snapshot came from a writer that
 * already wrote the current text (lib/ingest/video-insert.ts) — never overwrite it with ours.
 */
export function moveWindowSql(dry: boolean): string {
  const cols = TEXT_COLUMNS.join(', ');
  const page = `
    with ${WINDOW},
    unmoved as materialized (
      select win.id from win
       where not exists (select 1 from video_text vt where vt.video_id = win.id)
    ),
    page as (
      select v.id, ${TEXT_COLUMNS.map((c) => `v.${c}`).join(', ')}
        from unmoved u join videos v on v.id = u.id
    )`;
  const tail = (moved: string) => `
    select (select max(id) from win) as next_cursor,
           (select count(*) from win)::int as scanned,
           ${moved} as moved,
           (select coalesce(sum(coalesce(length(description), 0) + coalesce(length(metadata::text), 0)), 0)
              from page)::bigint as bytes`;
  if (dry) return `${page}${tail('(select count(*) from page)::int')}`;
  return `${page},
    ins as (
      insert into video_text (video_id, ${cols}, moved_at)
      select id, ${cols}, now() from page
      on conflict (video_id) do nothing
      returning video_id
    )${tail('(select count(*) from ins)::int')}`;
}

// ---- the null-out ---------------------------------------------------------------------
// Copying reclaims nothing: until the originals are NULL, `videos` still holds every byte. This
// is the only irreversible step, so it clears a row only after proving, in the same statement,
// that video_text holds the same bytes.
//
// THE DEFECT IT REPLACES (2026-09-14..26): the scheduled wrapper ran only when ZERO videos were
// unmoved, corpus-wide, by 05:48 — while daily ingest kept 3-30 K unmoved and the job itself
// started at 06:00. It stood down twelve nights out of twelve. There is no global gate now: each
// window clears what it can prove and counts what it cannot; tomorrow's pass picks up the rest.

/**
 * One window of the null-out. $1 = cursor, $2 = window size.
 * Returns one row: next_cursor, scanned, cleared, disagree, unmoved_holding.
 *
 * THE SAFETY PROPERTY. The equality predicate is in the UPDATE's own WHERE, on `videos` as the
 * target: `v.<col> is not distinct from vt.<col>`. Under READ COMMITTED a target row that was
 * changed after our snapshot is re-checked against its new version (EvalPlanQual), so a value
 * written concurrently is never nulled on the strength of an old match. `is not distinct from`,
 * never `=`: `=` is UNKNOWN on NULLs, which would skip rows forever or — written the other way —
 * clear a real original against a NULL side copy.
 *
 * `(v.<col> is not null or …)` keeps it idempotent. The `stats` CTE reads the same snapshot the
 * UPDATE started from, so disagree / unmoved_holding describe the rows it had to leave alone.
 */
export function nullWindowSql(columns: readonly TextColumn[]): string {
  const cols = checkColumns(columns);
  const equal = cols.map((c) => `v.${c} is not distinct from vt.${c}`).join('\n       and ');
  const holds = `(${cols.map((c) => `v.${c} is not null`).join(' or ')})`;
  const sets = cols.map((c) => `${c} = null`).join(', ');
  return `
    with ${WINDOW},
    stats as (
      select count(*) filter (where ${holds} and vt.video_id is not null
                               and not (${equal}))::int as disagree,
             count(*) filter (where ${holds} and vt.video_id is null)::int as unmoved_holding
        from win join videos v on v.id = win.id
        left join video_text vt on vt.video_id = v.id
    ),
    -- The side rows the proof relies on, locked: EvalPlanQual re-reads only the UPDATE target, so
    -- without this a side row changed or deleted after the snapshot would still be trusted
    -- (review P1-1). FOR SHARE returns the latest committed version and holds it until commit.
    locked as (
      select vt.video_id, ${cols.map((c) => `vt.${c}`).join(', ')}
        from video_text vt
       where vt.video_id in (select id from win)
         for share
    ),
    upd as (
      update videos v
         set ${sets}
        from locked vt
       where vt.video_id = v.id
         and v.id in (select id from win)
         and ${holds}
         and ${equal}
      returning v.id
    )
    select (select max(id) from win) as next_cursor,
           (select count(*) from win)::int as scanned,
           (select count(*) from upd)::int as cleared,
           stats.disagree as disagree,
           stats.unmoved_holding as unmoved_holding
      from stats`;
}

/** Is any llm_summary still held on `videos`? Answered from the partial index, not the heap. */
export const LLM_SUMMARY_HOLDING_SQL = `select 1 as held from videos where llm_summary is not null limit 1`;

// ---- the trigger the null-out must not run underneath ---------------------------------
//
// sql/2026-09-08-video-text.sql installs video_text_mirror_upd: AFTER UPDATE ON videos, WHEN
// one of the three columns changed, copy the NEW values into video_text. That trigger is what
// kept the two copies honest while the readers were being switched, and it is now the single
// most dangerous object in this migration.
//
// nullWindowSql() is `update videos set description = null, metadata = null, llm_summary = null`.
// That is precisely the WHEN condition. The trigger fires and upserts NULL, NULL, NULL into
// video_text. So the null-out does not free 2 GB of text — it DESTROYS it, one batch at a
// time, and every safety check in scripts/null-video-text.ts still passes at every step,
// because after the trigger has run the two copies really do agree. They agree on nothing.
//
// Measured on the live instance 2026-09-14: both video_text_mirror_ins and video_text_mirror_upd
// are installed on `videos`. The trigger must be dropped (sql/2026-09-14-retire-video-text-
// mirror.sql) before the null-out runs, and the null-out refuses to start while it exists.

/** Is the mirror trigger still installed on `videos`? $-free; returns one row per trigger. */
export const MIRROR_TRIGGER_SQL = `
  select tgname
    from pg_trigger
   where tgrelid = 'videos'::regclass
     and not tgisinternal
     and tgname like 'video_text_mirror%'`;

// ---- the dry-run coverage report ------------------------------------------------------
//
// "It would clear 1,097,222 rows" is not a report. The question before an irreversible pass is
// how many rows are PROVED safe, how many are not, and why not — because "not proved safe"
// has three different causes and only one of them is benign.

/**
 * The equality breakdown, over a BOUNDED SAMPLE of video_text.
 *
 * The obvious form of this query — `from videos v left join video_text vt` with count(*)
 * filters — is a sequential scan of a 1,734 MB heap plus a toast fetch per row. It was tried
 * on 2026-09-14 and the 120-second statement timeout cancelled it. `videos` is never scanned
 * without an index-backed predicate and a LIMIT.
 *
 * So the driving table is `video_text` (27 MB today), the join into `videos` is a primary-key
 * lookup, and $1 bounds how many rows are examined. The two whole-corpus numbers that matter
 * — how many videos exist and how many are not yet moved — come from MOVE_COUNT_REMAINING_SQL
 * and a count over video_text alone, neither of which touches the wide table.
 *
 * The buckets:
 *   verified_equal — all three columns byte-equal and there is text to clear. The work.
 *   already_clear  — all three originals already NULL. Nothing to do; counts as done.
 *   disagree       — an original that is NOT NULL differs from its side copy. The only
 *                    dangerous state, broken out per column so the report says which column
 *                    diverged rather than only that something did.
 *   unmoved is not in here: a row with no video_text row cannot be sampled from video_text.
 *   It is counted separately, by MOVE_COUNT_REMAINING_SQL.
 */
export const NULL_COVERAGE_SQL = `
  with sample as (
    select vt.video_id, vt.description, vt.metadata, vt.llm_summary
      from video_text vt
     order by vt.video_id
     limit $1
  )
  select
    count(*)::text as sampled,
    count(*) filter (where v.description is null and v.metadata is null and v.llm_summary is null
                  )::text as already_clear,
    count(*) filter (where (v.description is not null or v.metadata is not null or v.llm_summary is not null)
                       and v.description is not distinct from s.description
                       and v.metadata is not distinct from s.metadata
                       and v.llm_summary is not distinct from s.llm_summary
                  )::text as verified_equal,
    count(*) filter (where (v.description is not null and v.description is distinct from s.description)
                       or (v.metadata is not null and v.metadata is distinct from s.metadata)
                       or (v.llm_summary is not null and v.llm_summary is distinct from s.llm_summary)
                  )::text as disagree,
    count(*) filter (where v.description is not null and v.description is distinct from s.description)::text as disagree_description,
    count(*) filter (where v.metadata is not null and v.metadata is distinct from s.metadata)::text as disagree_metadata,
    count(*) filter (where v.llm_summary is not null and v.llm_summary is distinct from s.llm_summary)::text as disagree_llm_summary
  from sample s
  join videos v on v.id = s.video_id`;

/**
 * How many rows the mover has placed — the planner's estimate, from pg_class. An exact count is a
 * sequential scan of a 1.3 GB heap for a number that only ever appears in a report.
 */
export const MOVED_COUNT_SQL = `select greatest(reltuples, 0)::bigint::text as n from pg_class where oid = 'video_text'::regclass`;
