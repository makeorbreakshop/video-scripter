// Pure source-selection policy for launch-track. RSS may satisfy routine observation
// deadlines, while the API remains authoritative for bursts and periodic validation.

export const RSS_ROUTINE_MINUTES = 15;
export const RSS_FRESHNESS_CEILING_MINUTES = 20;
export const API_CROSSCHECK_HOURS = 6;

export interface SamplingCandidate {
  intervalMinutes: number | null;
  lastViews: number | null;
  lastApiAt: Date | null;
  rssAt: Date | null;
  rssViews: number | null;
}

export type SamplingDecision = {
  source: 'api' | 'rss';
  reason:
    | 'burst'
    | 'api_crosscheck_due'
    | 'missing_rss'
    | 'invalid_rss'
    | 'rss_not_newer'
    | 'stale_rss'
    | 'rss_declined'
    | 'fresh_rss';
};

export interface SamplingFreshnessPolicy {
  routineMinMinutes?: number;
  rssFreshnessCeilingMinutes?: number;
  apiCrosscheckHours?: number;
}

const validDateMs = (d: Date | null): number | null => {
  if (!d) return null;
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : null;
};

export function decideSamplingSource(
  candidate: SamplingCandidate,
  now: Date,
  policy: SamplingFreshnessPolicy = {},
): SamplingDecision {
  const routineMin = policy.routineMinMinutes ?? RSS_ROUTINE_MINUTES;
  const freshnessCeiling = policy.rssFreshnessCeilingMinutes ?? RSS_FRESHNESS_CEILING_MINUTES;
  const crosscheckMs = (policy.apiCrosscheckHours ?? API_CROSSCHECK_HOURS) * 3_600_000;
  const interval = candidate.intervalMinutes;

  if (interval == null || !Number.isFinite(interval) || interval < routineMin) {
    return { source: 'api', reason: 'burst' };
  }

  const nowMs = now.getTime();
  const apiMs = validDateMs(candidate.lastApiAt);
  if (apiMs == null || apiMs > nowMs || nowMs - apiMs >= crosscheckMs) {
    return { source: 'api', reason: 'api_crosscheck_due' };
  }

  if (!candidate.rssAt || candidate.rssViews == null) {
    return { source: 'api', reason: 'missing_rss' };
  }
  const rssMs = validDateMs(candidate.rssAt);
  if (rssMs == null || rssMs > nowMs || !Number.isFinite(candidate.rssViews) || candidate.rssViews < 0) {
    return { source: 'api', reason: 'invalid_rss' };
  }
  if (apiMs != null && rssMs <= apiMs) {
    return { source: 'api', reason: 'rss_not_newer' };
  }
  if (candidate.lastViews != null && candidate.rssViews < candidate.lastViews) {
    return { source: 'api', reason: 'rss_declined' };
  }

  const maxAgeMs = Math.min(interval, freshnessCeiling) * 60_000;
  if (nowMs - rssMs > maxAgeMs) return { source: 'api', reason: 'stale_rss' };
  return { source: 'rss', reason: 'fresh_rss' };
}
