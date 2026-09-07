// Experiment only. Not imported by the app, scorer, or scheduled poller.
export type RawReading = {
  eventId: string; videoId: string; views: number; fetchedAt: number;
  headers: { date: string | null; age: string | null; 'cache-control'?: string | null };
};
export type HistoricalReading = {
  videoId: string; views: number; at: number;
  timeBasis: 'response-date-estimate' | 'fetch-time-only';
  evidenceIds: string[]; conflict: boolean;
};
export function reconstructHistory(raw: RawReading[]): { audit: RawReading[]; history: HistoricalReading[] } {
  const points = new Map<string, HistoricalReading>();
  for (const r of raw) {
    const date = r.headers.date ? Date.parse(r.headers.date) : NaN;
    const known = Number.isFinite(date) && date <= r.fetchedAt;
    const at = known ? date : r.fetchedAt;
    const timeBasis = known ? 'response-date-estimate' : 'fetch-time-only';
    // Observation dedupe, not raw receipt dedupe: every fetch remains in audit.
    const key = JSON.stringify([r.videoId, at, r.views, timeBasis]);
    const existing = points.get(key);
    if (existing) existing.evidenceIds.push(r.eventId);
    else points.set(key, { videoId: r.videoId, views: r.views, at, timeBasis,
      evidenceIds: [r.eventId], conflict: false });
  }
  const history = [...points.values()].sort((a, b) => a.at - b.at);
  const countsAt = new Map<string, Set<number>>();
  for (const p of history) {
    const key = JSON.stringify([p.videoId, p.at]);
    if (!countsAt.has(key)) countsAt.set(key, new Set());
    countsAt.get(key)!.add(p.views);
  }
  for (const p of history) p.conflict = countsAt.get(JSON.stringify([p.videoId, p.at]))!.size > 1;
  return { audit: [...raw], history };
}
