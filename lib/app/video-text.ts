// The one way to read or write a video's long text.
//
// description, metadata and llm_summary are 86% of a `videos` row, and `videos` is 4 GB against
// a 512 MB buffer pool — so every page that joins the table pays for bytes it never renders.
// They live in `video_text` instead, and everything that wants them comes through here.
//
// DUAL-WRITE, ON PURPOSE. Until the null-out migration runs, `videos` still holds the
// authoritative copy and dozens of legacy routes still read it directly (they are listed in
// docs/runbooks/2026-09-08-site-speed.md, and clearing them is the precondition for the
// null-out). Writing both keeps those routes correct while the side table is proven, and the
// verification step is exactly "do the two agree for every row".
import { q } from '../admin/db';

export interface VideoText {
  videoId: string;
  description: string | null;
  metadata: Record<string, any> | null;
  llmSummary: string | null;
}

/** The projection to add to a videos query that genuinely needs the text. Joined, not inlined,
 *  so the planner can skip the side table entirely for the queries that do not select from it. */
export const VIDEO_TEXT_JOIN = 'left join video_text vt on vt.video_id = v.id';

export async function videoTextFor(videoIds: readonly string[]): Promise<Map<string, VideoText>> {
  const ids = [...new Set(videoIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await q<{ video_id: string; description: string | null; metadata: any; llm_summary: string | null }>(
    // coalesce so a row the mover has not reached yet still answers, from the original columns.
    `select v.id as video_id,
            coalesce(vt.description, v.description) as description,
            coalesce(vt.metadata, v.metadata) as metadata,
            coalesce(vt.llm_summary, v.llm_summary) as llm_summary
       from videos v left join video_text vt on vt.video_id = v.id
      where v.id = any($1::text[])`,
    [ids as string[]]
  );
  return new Map(rows.map((r) => [r.video_id, {
    videoId: r.video_id, description: r.description, metadata: r.metadata, llmSummary: r.llm_summary,
  }]));
}

/** Upsert the side-table copy. Callers still write the `videos` columns too, until the null-out. */
export const VIDEO_TEXT_UPSERT_SQL = `
  insert into video_text (video_id, description, metadata, llm_summary, moved_at)
  select x.video_id, x.description, x.metadata, x.llm_summary, now()
    from unnest($1::text[], $2::text[], $3::jsonb[], $4::text[])
      as x(video_id, description, metadata, llm_summary)
  on conflict (video_id) do update
     set description = excluded.description, metadata = excluded.metadata,
         llm_summary = excluded.llm_summary, moved_at = excluded.moved_at`;

export async function writeVideoText(rows: readonly VideoText[]): Promise<number> {
  if (!rows.length) return 0;
  await q(VIDEO_TEXT_UPSERT_SQL, [
    rows.map((r) => r.videoId),
    rows.map((r) => r.description),
    rows.map((r) => (r.metadata == null ? null : JSON.stringify(r.metadata))),
    rows.map((r) => r.llmSummary),
  ]);
  return rows.length;
}

// ---- the llm-summary worker's read and write path -------------------------------------
//
// These two queries used to be copy-pasted into seven workers/llm-summary-* variants, each
// naming `videos.llm_summary` directly. That is not a tidiness problem: `is('llm_summary',
// null)` is how every one of them decided what work was outstanding, and the moment the
// null-out sets that column to NULL the predicate matches all 1,118,401 rows — the worker
// would re-summarise the entire corpus at OpenAI's per-call price. The predicate has to come
// from the side table, so it lives here with the columns it reads.

/** `coalesce(vt.x, v.x)` — the side copy when the mover has reached the row, the original
 *  otherwise. Identical to what videoTextFor() returns, so the worker and the app agree. */
const coalesced = (c: string) => `coalesce(vt.${c}, v.${c})`;

/**
 * One batch of videos with no summary yet. $1 = keyset cursor over videos.id ('' to start),
 * $2 = batch size. Keyset, never OFFSET: this walks a 1.1 M-row table.
 */
export function needsSummaryBatchSql(): string {
  return `
    select v.id, v.title, v.channel_name,
           ${coalesced('description')} as description
      from videos v ${VIDEO_TEXT_JOIN}
     where v.id > $1
       and ${coalesced('llm_summary')} is null
     order by v.id
     limit $2`;
}

/** How much work is outstanding. Counted with exactly the predicate the batch selects on. */
export const NEEDS_SUMMARY_COUNT_SQL = `
  select count(*)::text as n
    from videos v ${VIDEO_TEXT_JOIN}
   where ${coalesced('llm_summary')} is null`;

/**
 * Write summaries back. $1 = video ids, $2 = summaries.
 *
 * Deliberately NOT VIDEO_TEXT_UPSERT_SQL: that form sets all three columns, and a summary
 * write carries no description or metadata, so reusing it would blank the description of
 * every row it touched. This one names llm_summary and nothing else.
 */
export const LLM_SUMMARY_UPSERT_SQL = `
  insert into video_text (video_id, llm_summary, moved_at)
  select x.video_id, x.llm_summary, now()
    from unnest($1::text[], $2::text[]) as x(video_id, llm_summary)
  on conflict (video_id) do update
     set llm_summary = excluded.llm_summary, moved_at = excluded.moved_at`;

export async function writeLlmSummaries(
  rows: readonly { videoId: string; llmSummary: string }[],
): Promise<number> {
  if (!rows.length) return 0;
  await q(LLM_SUMMARY_UPSERT_SQL, [rows.map((r) => r.videoId), rows.map((r) => r.llmSummary)]);
  return rows.length;
}

// ---- the vectorization worker's read path ---------------------------------------------
//
// workers/llm-summary-vectorization-worker.ts asked `videos` for rows that HAVE a summary and
// have not been embedded yet. That is the mirror image of the generation worker's bug and
// fails just as quietly: after the null-out `v.llm_summary is not null` is false for every
// row, so the worker reports nothing to do, for ever, and the llm-summaries namespace simply
// stops being filled. `llm_summary_embedding_synced` is not part of the move and stays on
// `videos` — it is a flag, not text.

/** One batch of summaries awaiting an embedding. $1 = keyset cursor, $2 = batch size. */
export function needsSummaryEmbeddingBatchSql(): string {
  return `
    select v.id, v.title, v.channel_name, v.view_count, v.published_at,
           ${coalesced('llm_summary')} as llm_summary
      from videos v ${VIDEO_TEXT_JOIN}
     where v.id > $1
       and ${coalesced('llm_summary')} is not null
       and v.llm_summary_embedding_synced = false
     order by v.id
     limit $2`;
}

export const NEEDS_SUMMARY_EMBEDDING_COUNT_SQL = `
  select count(*)::text as n
    from videos v ${VIDEO_TEXT_JOIN}
   where ${coalesced('llm_summary')} is not null
     and v.llm_summary_embedding_synced = false`;
