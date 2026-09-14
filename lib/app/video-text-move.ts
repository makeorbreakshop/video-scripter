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

/** The columns that move. Exactly these three; the list is asserted in the test. */
export const TEXT_COLUMNS = ['description', 'metadata', 'llm_summary'] as const;

/**
 * One batch of the move. $1 = keyset cursor over videos.id (use '' to start), $2 = batch size.
 *
 * `not exists (… video_text …)` is the correctness guarantee and `v.id > $1` is only the
 * performance one: with the anti-join alone the query would still be correct but would rescan
 * from the start of the table each time; with the keyset each batch is one ordered index range.
 */
export function moveBatchSql(dry: boolean): string {
  const cols = TEXT_COLUMNS.join(', ');
  const page = `
    with page as (
      select id, ${cols}
        from videos v
       where v.id > $1
         and not exists (select 1 from video_text vt where vt.video_id = v.id)
       order by v.id
       limit $2
    )`;
  if (dry) {
    return `${page}
    select id,
           (coalesce(length(description), 0) + coalesce(length(metadata::text), 0))::text as b
      from page`;
  }
  return `${page}, ins as (
      insert into video_text (video_id, ${cols}, moved_at)
      select id, ${cols}, now() from page
      on conflict (video_id) do update
         set description = excluded.description, metadata = excluded.metadata,
             llm_summary = excluded.llm_summary, moved_at = excluded.moved_at
      returning video_id
    )
    select p.id,
           (coalesce(length(p.description), 0) + coalesce(length(p.metadata::text), 0))::text as b
      from page p
     where exists (select 1 from ins)`;
}

/**
 * How many videos still have no row in video_text.
 *
 * Deliberately counted over `videos`, not over `video_text`: `count(*) from video_text` is what
 * made the broken run look finished. 19,659 rows moved is a true statement and a useless one.
 */
export const MOVE_COUNT_REMAINING_SQL = `
  select count(*)::text as n
    from videos v
   where not exists (select 1 from video_text vt where vt.video_id = v.id)`;

// ---- the null-out ---------------------------------------------------------------------
// Copying does not reclaim anything: until the originals are NULL, `videos` still holds every
// byte. This is the step that actually shrinks the table — and the only irreversible one, so it
// refuses to touch a row it has not just proved is already safely in video_text.

/**
 * One batch of the null-out. $1 = keyset cursor over videos.id, $2 = batch size.
 *
 * THE SAFETY PROPERTY: a row is cleared only when video_text holds a copy that is byte-for-byte
 * identical in all three columns, checked in the same statement that does the clearing — so
 * there is no window in which the comparison could be stale.
 *
 * `is not distinct from`, never `=`. `=` yields UNKNOWN when either side is NULL, and a WHERE
 * clause treats UNKNOWN as false, so `=` would silently skip every row with a NULL column
 * (6.7 % have no description, 26 % no metadata) and leave them forever. Worse, the inverse
 * mistake — writing the predicate so UNKNOWN passes — would clear a row whose side copy is NULL
 * against a real description, destroying the only copy. `is not distinct from` is exact on NULLs
 * in both directions.
 *
 * The `is not null` disjunction makes it idempotent: a row already cleared is equal to its
 * (also NULL) side copy and would otherwise match this predicate for ever.
 */
export type TextColumn = (typeof TEXT_COLUMNS)[number];

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

export function nullBatchSql(columns: readonly TextColumn[] = TEXT_COLUMNS): string {
  const cols = checkColumns(columns);
  const equal = cols.map((c) => `v.${c} is not distinct from vt.${c}`).join('\n           and ');
  const anyNotNull = cols.map((c) => `v.${c} is not null`).join(' or ');
  const sets = cols.map((c) => `${c} = null`).join(', ');
  return `
    with page as (
      select v.id
        from videos v
        join video_text vt on vt.video_id = v.id
       where v.id > $1
         and ${equal}
         and (${anyNotNull})
       order by v.id
       limit $2
    )
    update videos v
       set ${sets}
      from page p
     where v.id = p.id
    returning v.id`;
}

/** Rows that have been moved and still hold their originals, in the given columns. */
export function nullCountRemainingSql(columns: readonly TextColumn[] = TEXT_COLUMNS): string {
  const anyNotNull = checkColumns(columns).map((c) => `v.${c} is not null`).join(' or ');
  return `
  select count(*)::text as n
    from videos v
    join video_text vt on vt.video_id = v.id
   where (${anyNotNull})`;
}

/**
 * Disagreements between the two copies, in the given columns. Must return zero rows before any
 * null-out runs: a non-empty result means the mover and the mirror trigger have diverged, and
 * clearing on that basis would lose text. $1 = limit.
 *
 * `v.<col> is not null and ...`: once the writers stop populating the `videos` columns and write
 * only to video_text, the ordinary state of a freshly-written row is a NULL original against a
 * real side copy. The bare `is distinct from` form calls that a disagreement and the gate would
 * refuse to run at all — on rows where there is, by definition, nothing to destroy. This gate
 * exists to protect text that only `videos` still holds.
 */
export function nullVerifySql(columns: readonly TextColumn[] = TEXT_COLUMNS): string {
  const bad = checkColumns(columns)
    .map((c) => `(v.${c} is not null and v.${c} is distinct from vt.${c})`).join('\n      or ');
  return `
  select v.id
    from videos v
    join video_text vt on vt.video_id = v.id
   where ${bad}
   limit $1`;
}

/** Back-compat aliases for the all-three case. */
export const NULL_COUNT_REMAINING_SQL = nullCountRemainingSql();
export const NULL_VERIFY_SQL = nullVerifySql();

// ---- the trigger the null-out must not run underneath ---------------------------------
//
// sql/2026-09-08-video-text.sql installs video_text_mirror_upd: AFTER UPDATE ON videos, WHEN
// one of the three columns changed, copy the NEW values into video_text. That trigger is what
// kept the two copies honest while the readers were being switched, and it is now the single
// most dangerous object in this migration.
//
// nullBatchSql() is `update videos set description = null, metadata = null, llm_summary = null`.
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

/** How many rows the mover has placed. Over video_text alone — never touches `videos`. */
export const MOVED_COUNT_SQL = `select count(*)::text as n from video_text`;
