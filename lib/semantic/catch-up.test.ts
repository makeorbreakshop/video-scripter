import { CHANNEL_FILTER_MAX_GAP_MS, channelUpdatedSince } from './catch-up';

describe('channelUpdatedSince', () => {
  const now = new Date('2026-11-08T05:00:00Z');
  it('keeps the incremental filter for a normal hourly gap', () => {
    const since = new Date(now.getTime() - 65 * 60_000);
    expect(channelUpdatedSince(since, now)).toBe(since);
  });
  it('keeps it right at the boundary', () => {
    const since = new Date(now.getTime() - CHANNEL_FILTER_MAX_GAP_MS);
    expect(channelUpdatedSince(since, now)).toBe(since);
  });
  it('drops it after a long outage so the leg re-checks the whole window', () => {
    expect(channelUpdatedSince(new Date('2026-10-26T12:01:28Z'), now)).toBeUndefined();
  });
});
