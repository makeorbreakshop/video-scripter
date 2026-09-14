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
export function nullBatchSql(): string {
  const equal = TEXT_COLUMNS.map((c) => `v.${c} is not distinct from vt.${c}`).join('\n           and ');
  return `
    with page as (
      select v.id
        from videos v
        join video_text vt on vt.video_id = v.id
       where v.id > $1
         and ${equal}
         and (v.description is not null or v.metadata is not null or v.llm_summary is not null)
       order by v.id
       limit $2
    )
    update videos v
       set description = null, metadata = null, llm_summary = null
      from page p
     where v.id = p.id
    returning v.id`;
}

/** Rows that have been moved and still hold their originals. The null-out's remaining work. */
export const NULL_COUNT_REMAINING_SQL = `
  select count(*)::text as n
    from videos v
    join video_text vt on vt.video_id = v.id
   where (v.description is not null or v.metadata is not null or v.llm_summary is not null)`;

/**
 * Disagreements between the two copies. Must return zero rows before any null-out runs: a
 * non-empty result means the mover and the mirror trigger have diverged somewhere, and clearing
 * on that basis would lose text. $1 = limit.
 */
export const NULL_VERIFY_SQL = `
  select v.id
    from videos v
    join video_text vt on vt.video_id = v.id
   where v.description is distinct from vt.description
      or v.metadata is distinct from vt.metadata
      or v.llm_summary is distinct from vt.llm_summary
   limit $1`;
