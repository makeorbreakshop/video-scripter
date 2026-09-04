import { isShortForFilledDuration } from './duration-fill';

// scripts/fill-durations.ts backfills videos.duration from videos.list contentDetails. Until
// 2026-09-04 it also wrote `is_short = /^PT(([0-5]?[0-9])S|1M([0-2]S)?)$/.test(duration)` — a
// private copy of the classic <= 62s ceiling that flipped every 63-180s clip to is_short = false
// with no routing check behind it, and never stamped shorts_checked_at. It now defers to the one
// rule in lib/ingest/classify.ts.
describe('fill-durations decides is_short by the one rule', () => {
  test('<= 62s is a Short with no question asked', () => {
    expect(isShortForFilledDuration('PT45S')).toBe(true);
    expect(isShortForFilledDuration('PT1M2S')).toBe(true);   // 62s, the classic ceiling
  });

  test('63-180s is undecidable from duration: leave is_short for the verifier', () => {
    expect(isShortForFilledDuration('PT1M3S')).toBeNull();   // 63s
    expect(isShortForFilledDuration('PT2M')).toBeNull();     // 120s: a Short or a trailer
    expect(isShortForFilledDuration('PT3M')).toBeNull();     // 180s, the Shorts ceiling
  });

  test('> 180s is long-form', () => {
    expect(isShortForFilledDuration('PT3M1S')).toBe(false);
    expect(isShortForFilledDuration('PT1H2M3S')).toBe(false);
  });

  test('a placeholder or unparsable duration decides nothing', () => {
    expect(isShortForFilledDuration('P0D')).toBeNull();
    expect(isShortForFilledDuration('PT')).toBeNull();
    expect(isShortForFilledDuration('')).toBeNull();
    expect(isShortForFilledDuration(null)).toBeNull();
  });
});
