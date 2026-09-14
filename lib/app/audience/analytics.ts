import { q } from '../../admin/db';
import { accessTokenFromRefresh } from '../youtube-connect';
import { ownerChannel } from './owner';
import { REPORTS, audienceWindow, reportRows, type AudienceDimension, type AudienceFact, type AnalyticsReport } from './analytics-core';

export async function pullChannelAudience(channelId: string): Promise<Record<AudienceDimension, number>> {
  const { refreshToken } = await ownerChannel(channelId);
  const token = await accessTokenFromRefresh(refreshToken);
  const { startDate, endDate } = audienceWindow(new Date());
  const facts: AudienceFact[] = [];
  const counts = {} as Record<AudienceDimension, number>;
  for (const [dimension, report] of Object.entries(REPORTS) as [AudienceDimension, typeof REPORTS[AudienceDimension]][]) {
    const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
    for (const [key, value] of Object.entries({ ids: 'channel==MINE', startDate, endDate, ...report })) {
      if (value) url.searchParams.set(key, value);
    }
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    const body = await res.json() as AnalyticsReport & { error?: { message?: string } };
    if (!res.ok) throw new Error(`analytics ${dimension} ${res.status}: ${body.error?.message || 'unknown error'}`);
    const parsed = reportRows(dimension, body);
    counts[dimension] = parsed.length;
    facts.push(...parsed);
  }
  for (const fact of facts) {
    await q(`insert into channel_audience (channel_id, dimension, key, value, window_days, window_end)
      values ($1,$2,$3,$4,90,$5) on conflict (channel_id, dimension, key, window_end)
      do update set value = excluded.value, fetched_at = now()`,
      [channelId, fact.dimension, fact.key, fact.value, endDate]);
  }
  return counts;
}
