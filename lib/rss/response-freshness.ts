export type ResponseEvidence = { fetchedAt: string; date: string | null; age: string | null; cacheControl: string | null };
/** HTTP Date describes the response, not when YouTube measured its counts.
 * Age without Date is insufficient to establish an exact comparable source clock.
 */
export function assessResponse(previousDate: string | null, evidence: ResponseEvidence) {
  const dateMs = evidence.date ? Date.parse(evidence.date) : NaN;
  const fetchedMs = Date.parse(evidence.fetchedAt);
  const responseDate = Number.isFinite(dateMs) && dateMs <= fetchedMs ? new Date(dateMs).toISOString() : null;
  const stale = responseDate !== null && previousDate !== null && Date.parse(responseDate) < Date.parse(previousDate);
  return { stale, responseDate, watermark: responseDate && !stale ? responseDate : previousDate };
}

export type FeedResponse = ResponseEvidence & { channelId: string; views: Record<string, number> };
export type ResponseCounters = Record<'responses' | 'unknownResponses' | 'staleResponses' |
  'readings' | 'staleDecreases' | 'unknownDecreases' | 'rawComparisons' | 'rawDecreases' | 'acceptedComparisons' | 'acceptedDecreases', number>;
export type ResponseState = {
  since: string; watermark: string | null; latest: FeedResponse;
  rejected: FeedResponse | null; acceptedViews: Record<string, number>; counters: ResponseCounters;
};
export function advanceResponse(previous: ResponseState | null, response: FeedResponse): { state: ResponseState; accepted: boolean; replay: boolean } {
  if (previous && Date.parse(response.fetchedAt) <= Date.parse(previous.latest.fetchedAt)) {
    return { state: previous, accepted: false, replay: true };
  }
  const assessment = assessResponse(previous?.watermark ?? null, response);
  const counters: ResponseCounters = previous ? { ...previous.counters } : {
    responses: 0, unknownResponses: 0, staleResponses: 0, readings: 0, staleDecreases: 0, unknownDecreases: 0,
    rawComparisons: 0, rawDecreases: 0, acceptedComparisons: 0, acceptedDecreases: 0,
  };
  counters.responses++;
  if (!assessment.responseDate) counters.unknownResponses++;
  if (assessment.stale) counters.staleResponses++;
  for (const [id, views] of Object.entries(response.views)) {
    counters.readings++;
    const raw = previous?.latest.views[id];
    if (raw != null) {
      counters.rawComparisons++;
      if (views < raw) {
        counters.rawDecreases++;
        if (assessment.stale) counters.staleDecreases++;
      }
    }
    const accepted = previous?.acceptedViews[id];
    if (!assessment.stale && accepted != null) {
      counters.acceptedComparisons++;
      if (views < accepted) {
        counters.acceptedDecreases++;
        if (!assessment.responseDate) counters.unknownDecreases++;
      }
    }
  }
  return { accepted: !assessment.stale, replay: false, state: {
    since: previous?.since ?? response.fetchedAt, watermark: assessment.watermark,
    latest: response, rejected: assessment.stale ? response : previous?.rejected ?? null,
    acceptedViews: assessment.stale ? previous?.acceptedViews ?? {} : response.views,
    counters,
  } };
}
