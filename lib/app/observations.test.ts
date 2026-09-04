// A stale reading is a real thing in the data, not a modelling nicety: BPS.space PpwewkOCFuE
// was ingested at 20:27:58 ET with a view count YouTube had cached hours earlier (77,993),
// and four minutes later the counter said 110,729. Anchoring the reconstructed past on that
// first number scaled the whole launch to a lie, and the measured line then "jumped" 42% in
// four minutes. These tests pin the rule that finds such a reading.
import {
  markObservations, fittablePoints, STALE_WINDOW_DAYS, STALE_JUMP, STALE_RATE_RATIO,
} from './observations';

const ET_OFFSET_H = 4; // 2026-09-03 is EDT (UTC-4)
/** PpwewkOCFuE published 2026-09-03 18:14Z = 14:14 ET. Days since publish for an ET clock time. */
const at = (h: number, m: number, s = 0) => (h + m / 60 + s / 3600 - (18 - ET_OFFSET_H) - 14 / 60) / 24;

/** The real sequence: an ingest-time sample, a stuck repeat, then a normal launch ladder. */
const PPWEWK = [
  { day: at(20, 27, 58), views: 77_993 },
  { day: at(20, 32, 9), views: 110_729 },
  { day: at(20, 47), views: 110_729 },
  { day: at(21, 2), views: 144_192 },
  { day: at(21, 17), views: 160_000 },
  { day: at(21, 32), views: 173_000 },
  { day: at(21, 47), views: 184_000 },
  { day: at(22, 17), views: 202_000 },
  { day: at(22, 47), views: 217_000 },
  { day: at(23, 47), views: 243_000 },
  { day: 1.26, views: 400_000 },
];

describe('markObservations: a reading contradicted minutes later is stale', () => {
  it('marks only the 77,993 ingest-time reading on PpwewkOCFuE', () => {
    const m = markObservations(PPWEWK);
    expect(m.filter((r) => r.stale).map((r) => r.views)).toEqual([77_993]);
  });

  it('drops the repeated 110,729 from the fit, keeping the first of the run', () => {
    const m = markObservations(PPWEWK);
    const dupes = m.filter((r) => r.duplicate);
    expect(dupes.length).toBe(1);
    expect(dupes[0].views).toBe(110_729);
    expect(dupes[0].day).toBeCloseTo(at(20, 47), 9);
    // the first of the run stays, and stays fittable
    expect(m.find((r) => r.day === at(20, 32, 9))!.duplicate).toBe(false);
    expect(fittablePoints(PPWEWK).map((p) => p.views)).toEqual(
      [110_729, 144_192, 160_000, 173_000, 184_000, 202_000, 217_000, 243_000, 400_000]
    );
  });

  it('marks nothing on a normal launch ladder', () => {
    const ladder = PPWEWK.slice(3); // 144,192 onward: steep, but steadily so
    expect(markObservations(ladder).some((r) => r.stale)).toBe(false);
  });

  it('leaves a genuine slow rise alone, however large the daily step', () => {
    const slow = [0, 1, 2, 3, 4, 5].map((d) => ({ day: d, views: 1000 * Math.pow(1.5, d) }));
    expect(markObservations(slow).some((r) => r.stale || r.duplicate)).toBe(false);
  });

  it('needs both a jump inside the window and a rate its neighbours contradict', () => {
    // a 42% jump four minutes apart, with nothing local to compare it against, is not enough
    const bare = [{ day: 0.2, views: 78_000 }, { day: 0.2 + 4 / 1440, views: 110_000 }];
    expect(markObservations(bare).some((r) => r.stale)).toBe(false);
  });

  it('exposes the constants the rule is written in', () => {
    expect(STALE_WINDOW_DAYS).toBeCloseTo(30 / 1440, 12);
    expect(STALE_JUMP).toBeCloseTo(0.1, 12);
    expect(STALE_RATE_RATIO).toBeGreaterThanOrEqual(2);
  });

  it('returns readings in day order, ignoring the order they arrive in', () => {
    const m = markObservations([...PPWEWK].reverse());
    expect(m.map((r) => r.day)).toEqual([...m.map((r) => r.day)].sort((a, b) => a - b));
    expect(m.filter((r) => r.stale).map((r) => r.views)).toEqual([77_993]);
  });

  it('survives empty, single and malformed input', () => {
    expect(markObservations([])).toEqual([]);
    expect(markObservations([{ day: 1, views: 5 }]).map((r) => r.stale)).toEqual([false]);
    expect(markObservations([{ day: NaN, views: 5 }, { day: 1, views: -3 } as any])).toEqual([]);
  });
});
