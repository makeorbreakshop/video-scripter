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
