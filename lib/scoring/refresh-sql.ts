/** Incremental scoring across all ages. --all removes the age ceiling, not the watermark.
 * Version mismatch makes a model rollout resumable; new evidence makes already-scored rows due.
 * Aliases v (videos) and sc (video_scores) are supplied by the caller.
 */
export function scoreRefreshSql(version: string): string {
  const literal = version.replace(/'/g, "''");
  return `(sc.video_id is null or sc.model_version is distinct from '${literal}'
    or exists (select 1 from rss_samples r where r.video_id = v.id and r.at > sc.scored_at and r.at <= now() and r.views >= 0)
    or exists (select 1 from view_samples s where s.video_id = v.id and s.sampled_at > sc.scored_at)
    or exists (select 1 from view_snapshots s where s.video_id = v.id and s.created_at > sc.scored_at))`;
}
