// Route-level seams for the API handlers that used to read the `videos` text columns directly.
//
// Two distinct hazards live here, and only one of them looks like a hazard:
//
//  1. PROJECTIONS — `.select('id, title, description')`. Obvious, and obviously broken by the
//     null-out. Fixed by dropping the column and hydrating with videoTextFor().
//  2. PREDICATES — `.is('llm_summary', null)` / `.not('llm_summary','is',null)`. These read
//     like ordinary filters and survive review, but once the column is NULL for every row the
//     first matches the whole 1.1 M-row corpus and the second matches nothing. Every progress
//     bar, remaining-count and cost estimate built on them flips silently. They are rewritten
//     as SQL over the side table and pinned by video-text-routes.test.ts.
//
// The bookkeeping siblings — llm_summary_embedding_synced / _generated_at / _model — stay on
// `videos` and are deliberately still read from `v.`.
import { VIDEO_TEXT_JOIN, type VideoText } from './video-text';

/** The authoritative summary for a row: the side-table copy, falling back to the original for
 *  rows the mover has not reached yet. Identical to what videoTextFor() returns. */
const SUMMARY = 'coalesce(vt.llm_summary, v.llm_summary)';

/** $1 = the owner channel name to exclude. `<>` and not `is distinct from`, because that is
 *  what supabase-js `.neq()` compiled to: rows with a NULL channel_name were never counted. */
export const SUMMARY_PENDING_COUNT_SQL = `
  select count(*)::int as count
    from videos v ${VIDEO_TEXT_JOIN}
   where ${SUMMARY} is null
     and v.channel_name <> $1`;

export const SUMMARY_DONE_COUNT_SQL = `
  select count(*)::int as count
    from videos v ${VIDEO_TEXT_JOIN}
   where ${SUMMARY} is not null`;

/** Vectorization progress: how many summaries exist, and how many have been embedded. */
export const SUMMARY_VECTORIZATION_TOTAL_SQL = `
  select count(*)::int as count
    from videos v ${VIDEO_TEXT_JOIN}
   where ${SUMMARY} is not null`;

export const SUMMARY_VECTORIZATION_DONE_SQL = `
  select count(*)::int as count
    from videos v ${VIDEO_TEXT_JOIN}
   where ${SUMMARY} is not null
     and v.llm_summary_embedding_synced = true`;

/** Put `description` back on rows selected without it. Order and length are preserved: a video
 *  with no side-table row gets `null`, never `undefined` and never removal from the batch. */
export function hydrateDescriptions<T extends { id: string }>(
  rows: readonly T[],
  text: ReadonlyMap<string, VideoText>,
): Array<T & { description: string | null }> {
  return rows.map((r) => ({ ...r, description: text.get(r.id)?.description ?? null }));
}

function asObject(metadata: unknown): Record<string, any> | null {
  if (metadata == null) return null;
  if (typeof metadata !== 'string') return metadata as Record<string, any>;
  try { return JSON.parse(metadata); } catch { return null; }
}

/** Fill the three text fields of a single video payload — the shape /api/videos/[videoId]
 *  returns, and which the detail page and the detail modal render. A missing side-table row
 *  yields nulls rather than whatever stale value the `videos` row still carried. */
export function hydrateVideoText<T extends Record<string, any>>(
  video: T,
  text: VideoText | undefined,
): T & { description: string | null; metadata: Record<string, any> | null; llm_summary: string | null } {
  return {
    ...video,
    description: text?.description ?? null,
    metadata: asObject(text?.metadata),
    llm_summary: text?.llmSummary ?? null,
  };
}
