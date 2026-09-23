// Depth + oldest-age alerts for the three derived-state queues behind the 2026-09-11 pipeline.
// 2026-09-22: the materializer rolled back every run for ~17 h and the scorer deferred 99% of
// its targets while the old single boolean stayed buried in a JSON blob. Each queue now gets its
// own ALERT line naming the depth and the age of its oldest due row.

export const QUEUE_HEALTH_SQL = `/* trace:pipeline.queue-health */
  select
    (select count(*)::int from obs_cache_dirty where not requires_bootstrap) as observation_depth,
    (select coalesce(extract(epoch from now()-min(marked_at)),0)::int
       from obs_cache_dirty where not requires_bootstrap) as observation_oldest_seconds,
    (select count(*)::int from score_dirty where not_before <= now()) as score_depth,
    (select coalesce(extract(epoch from now()-min(not_before)),0)::int
       from score_dirty where not_before <= now()) as score_oldest_seconds,
    (select count(*)::int from series_dirty) as series_depth,
    (select coalesce(extract(epoch from now()-min(marked_at)),0)::int
       from series_dirty) as series_oldest_seconds`;

export interface QueueLimit { job: string; queue: string; maxDepth: number; maxAgeSeconds: number | null }

/**
 * Limits for a pipeline running at its scheduled cadence (materializer every 5 min, scorer every
 * 5 min at 100/run, series drain every 10 min). Under SERIES_HYBRID=1 the series drain is off by
 * design, so age is meaningless there; only unbounded growth of the write-only queue alerts.
 */
export function queueLimits(seriesHybrid: boolean): QueueLimit[] {
  return [
    { job: 'observation-materializer', queue: 'obs_cache_dirty', maxDepth: 25_000, maxAgeSeconds: 30 * 60 },
    { job: 'score', queue: 'score_dirty (due)', maxDepth: 5_000, maxAgeSeconds: 2 * 3600 },
    seriesHybrid
      ? { job: 'series-drain', queue: 'series_dirty', maxDepth: 250_000, maxAgeSeconds: null }
      : { job: 'series-drain', queue: 'series_dirty', maxDepth: 20_000, maxAgeSeconds: 30 * 60 },
  ];
}

export interface QueueAssessment extends QueueLimit { depth: number; oldestSeconds: number; alert: boolean }

export function assessQueues(row: Record<string, unknown>, seriesHybrid: boolean): QueueAssessment[] {
  const key = ['observation', 'score', 'series'];
  return queueLimits(seriesHybrid).map((limit, i) => {
    const depth = Number(row[`${key[i]}_depth`] ?? 0);
    const oldestSeconds = Number(row[`${key[i]}_oldest_seconds`] ?? 0);
    const alert = depth > limit.maxDepth
      || (limit.maxAgeSeconds !== null && depth > 0 && oldestSeconds > limit.maxAgeSeconds);
    return { ...limit, depth, oldestSeconds, alert };
  });
}

const hours = (s: number) => `${(s / 3600).toFixed(1)} h`;

export function queueAlertLine(q: QueueAssessment): string {
  const age = q.maxAgeSeconds === null ? 'age not limited' : `limit ${hours(q.maxAgeSeconds)}`;
  return `ALERT queue backlog: ${q.job} — ${q.queue} depth ${q.depth} (limit ${q.maxDepth}), `
    + `oldest ${hours(q.oldestSeconds)} (${age})`;
}
