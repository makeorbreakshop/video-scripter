import { isBattleEligible, looksLikePlaceholderThumb } from './eligibility';

const base = {
  thumbnail_url: 'https://i.ytimg.com/vi/abc123defgh/hqdefault.jpg',
  duration: 'PT12M30S',
  is_short: false,
  is_institutional: false,
  temporal_performance_score: 1.5,
};

describe('isBattleEligible — the blank-thumbnail regression', () => {
  it('accepts a normal video', () => {
    expect(isBattleEligible(base)).toBe(true);
  });

  it("rejects live streams (duration P0D) — 827 of these passed the old filters", () => {
    expect(isBattleEligible({ ...base, duration: 'P0D' })).toBe(false);
    expect(isBattleEligible({ ...base, duration: 'PT0S' })).toBe(false);
  });

  it('tolerates legacy rows with no duration (old corpus predates the column)', () => {
    expect(isBattleEligible({ ...base, duration: null })).toBe(true);
    expect(isBattleEligible({ ...base, duration: undefined })).toBe(true);
  });

  it('rejects missing thumbnails, shorts, institutional, and bad scores', () => {
    expect(isBattleEligible({ ...base, thumbnail_url: null })).toBe(false);
    expect(isBattleEligible({ ...base, is_short: true })).toBe(false);
    expect(isBattleEligible({ ...base, is_institutional: true })).toBe(false);
    expect(isBattleEligible({ ...base, temporal_performance_score: 0.05 })).toBe(false);
    expect(isBattleEligible({ ...base, temporal_performance_score: 300 })).toBe(false);
    expect(isBattleEligible({ ...base, temporal_performance_score: null })).toBe(false);
  });
});

describe('looksLikePlaceholderThumb', () => {
  it('404 = placeholder', () => {
    expect(looksLikePlaceholderThumb(404, null)).toBe(true);
  });

  it("200 with YouTube's ~1KB gray JPEG = placeholder", () => {
    expect(looksLikePlaceholderThumb(200, 1093)).toBe(true);
  });

  it('200 with a real-sized thumbnail = fine', () => {
    expect(looksLikePlaceholderThumb(200, 48211)).toBe(false);
  });

  it('200 with unknown length = trust it (no false rejects)', () => {
    expect(looksLikePlaceholderThumb(200, null)).toBe(false);
  });
});
