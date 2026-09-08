import { confidenceChip, headerStats, ageShort } from './video-page';

const head = (over: Partial<any> = {}) => ({
  id: 'abc', title: 't', channelName: 'C', publishedAt: '2026-09-01T00:00:00Z',
  views: 75_000, ageDays: 7, pace: 2.1, expectedNow: 36_000, headline: 'now' as const,
  score: null, ...over,
});

describe('confidenceChip', () => {
  it('says settled, not confirmed', () => {
    expect(confidenceChip('confirmed')).toBe('SETTLED');
  });
  it('keeps the model words it can use', () => {
    expect(confidenceChip('likely')).toBe('LIKELY');
    expect(confidenceChip('early')).toBe('EARLY');
  });
  it('shows no chip rather than an unknown one', () => {
    expect(confidenceChip('insufficient')).toBeNull();
    expect(confidenceChip(null)).toBeNull();
  });
});

describe('ageShort', () => {
  it('drops the word', () => {
    expect(ageShort(7)).toBe('7d');
    expect(ageShort(0.75)).toBe('18h');
    expect(ageShort(0.02)).toBe('29m');
  });
});

describe('headerStats', () => {
  it('leads with the ratio and carries views, age and typical', () => {
    const h = headerStats(head());
    expect(h.big).toBe('2.1×');
    expect(h.over).toBe(true);
    expect(h.stats.map((s) => s.label)).toEqual(['VIEWS', 'OLD', 'TYPICAL']);
    expect(h.stats.map((s) => s.value)).toEqual(['75K', '7d', '36K']);
  });

  it('has NO day-30 stat — the projection is the dashed line', () => {
    const h = headerStats(head({ score: { score: 2.1, typical_at_age: 36_000, age_days: 7, est30: 92_000, confidence: 'confirmed' } }));
    expect(h.stats.map((s) => s.label)).not.toContain('DAY 30 EST');
    expect(JSON.stringify(h.stats)).not.toContain('92');
  });

  it('reads the same-age score when there is one', () => {
    const h = headerStats(head({ pace: 9, score: { score: 1.4, typical_at_age: 50_000, age_days: 7, confidence: 'likely' } }));
    expect(h.big).toBe('1.4×');
    expect(h.confidence).toBe('LIKELY');
    expect(h.stats.find((s) => s.label === 'TYPICAL')?.value).toBe('50K');
  });

  it('marks a video under its channel normal', () => {
    expect(headerStats(head({ pace: 0.6 })).over).toBe(false);
  });

  it('drops TYPICAL rather than printing a blank', () => {
    expect(headerStats(head({ expectedNow: null })).stats.map((s) => s.label)).toEqual(['VIEWS', 'OLD']);
  });

  it('says nothing at all for a broadcast', () => {
    expect(headerStats(head({ broadcastNotice: 'Stream in progress' }))).toEqual({ big: null, over: false, stats: [], confidence: null });
  });
});
