/** Shared observation contract for scoring and curves. Formula/fit remains v5.0. */
export const OBSERVATION_SCORE_VERSION = 'v5.1-rss';
export type ObservationPoint = { at: string | Date; views: number };
export type Observation = { day: number; views: number; source: 'snapshot' | 'sample' | 'rss'; at: string };
const rank = { snapshot: 0, rss: 1, sample: 2 };

/** Real timed observations supersede synthetic daily anchors, never neighboring RSS points.
 * Keep both plateau endpoints (including the newest clock), without weighting every repeated
 * fetch as independent growth evidence. Counter corrections are valid measurements.
 */
export function mergeObservations(
  publishedAt: string | Date, snapshots: ObservationPoint[], samples: ObservationPoint[],
  rss: ObservationPoint[] = [], asOf = Date.now()
): Observation[] {
  const published = new Date(publishedAt).getTime();
  const byTime = new Map<number, Observation>();
  const measuredDays = new Set<string>();
  for (const [points, source] of [[samples, 'sample'], [rss, 'rss'], [snapshots, 'snapshot']] as const) {
    for (const p of points) {
      const ms = new Date(p.at).getTime(), views = Number(p.views);
      if (!Number.isFinite(ms) || !Number.isFinite(published) || ms < published || ms > asOf || !Number.isFinite(views) || views < 0) continue;
      const at = new Date(ms).toISOString(), dayKey = at.slice(0, 10);
      if (source === 'snapshot' && measuredDays.has(dayKey)) continue;
      if (source !== 'snapshot') measuredDays.add(dayKey);
      const existing = byTime.get(ms);
      if (!existing || rank[source] > rank[existing.source]) byTime.set(ms, { at, views, source, day: (ms - published) / 86400000 });
    }
  }
  const sorted = [...byTime.values()].sort((a, b) => a.day - b.day);
  return sorted.filter((p, i) => i === 0 || i === sorted.length - 1 || p.views !== sorted[i - 1].views || p.views !== sorted[i + 1].views);
}

/** Keyed unions avoid the old correlated +/-12h RSS anti-join (quadratic on dense records). */
export const OBSERVATION_RECORDS_SQL = `
  with target_videos as materialized (
    select id, published_at from videos where id = any($1)
  )
  select x.video_id, x.at, x.views, x.source, v.published_at
  from (
    select video_id, snapshot_date::timestamptz + interval '12 hours' as at, view_count as views, 'snapshot' as source
    from view_snapshots where video_id = any($1)
    union all
    select video_id, sampled_at, view_count, 'sample' from view_samples where video_id = any($1)
    union all
    select video_id, at, views, 'rss' from rss_samples where video_id = any($1)
  ) x join target_videos v on v.id = x.video_id
  where x.views >= 0 and x.at >= v.published_at and x.at <= now()`;

export function observationRecords(rows: { video_id: string; published_at: string | Date; at: string | Date; views: number; source: Observation['source'] }[], asOf = Date.now()): Map<string, Observation[]> {
  const grouped = new Map<string, { published: string | Date; snapshot: ObservationPoint[]; sample: ObservationPoint[]; rss: ObservationPoint[] }>();
  for (const r of rows) {
    if (!grouped.has(r.video_id)) grouped.set(r.video_id, { published: r.published_at, snapshot: [], sample: [], rss: [] });
    grouped.get(r.video_id)![r.source].push({ at: r.at, views: Number(r.views) });
  }
  return new Map([...grouped].map(([id, g]) => [id, mergeObservations(g.published, g.snapshot, g.sample, g.rss, asOf)]));
}
