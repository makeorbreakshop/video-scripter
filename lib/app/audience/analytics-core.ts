export type AudienceDimension = 'age_gender' | 'country' | 'device' | 'traffic_source' | 'subscribed_status';
export const REPORTS: Record<AudienceDimension, { dimensions: string; metrics: string; sort?: string; maxResults?: string }> = {
  age_gender: { dimensions: 'ageGroup,gender', metrics: 'viewerPercentage' },
  country: { dimensions: 'country', metrics: 'views', sort: '-views', maxResults: '25' },
  device: { dimensions: 'deviceType', metrics: 'views' },
  traffic_source: { dimensions: 'insightTrafficSourceType', metrics: 'views' },
  subscribed_status: { dimensions: 'subscribedStatus', metrics: 'views' },
};

export interface AudienceFact { dimension: AudienceDimension; key: string; value: number }
export interface AnalyticsReport { columnHeaders?: { name: string }[]; rows?: (string | number)[][] }

export function reportRows(dimension: AudienceDimension, report: AnalyticsReport): AudienceFact[] {
  const headers = (report.columnHeaders ?? []).map((h) => h.name);
  const expected = REPORTS[dimension];
  const keys = expected.dimensions.split(',');
  const positions = [...keys, expected.metrics].map((name) => headers.indexOf(name));
  if (positions.some((i) => i < 0)) throw new Error(`missing columns in ${dimension} report`);
  return (report.rows ?? []).map((row) => {
    const key = positions.slice(0, -1).map((i) => String(row[i])).join('|');
    const value = Number(row[positions[positions.length - 1]]);
    if (!key || !Number.isFinite(value) || value < 0) throw new Error(`invalid ${dimension} report row`);
    return { dimension, key, value };
  });
}

/** 90 complete calendar days including yesterday. */
export function audienceWindow(now: Date): { startDate: string; endDate: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end.getTime() - 89 * 86400000);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}
