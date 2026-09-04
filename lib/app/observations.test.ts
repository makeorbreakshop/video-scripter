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

// ------------------------------------------------ where a snapshot goes on the chart ----
import { snapshotTimeMs, snapshotTimeIso, snapshotAnchor, SNAPSHOT_TRUST_MS } from './observations';

describe('snapshotTimeMs: a snapshot is drawn when it was taken, unless that is an import time', () => {
  const DAY = '2026-09-04';
  const anchor = Date.UTC(2026, 8, 4, 12); // noon UTC = 8 AM ET

  it('anchors at noon UTC on the snapshot day', () => {
    expect(snapshotAnchor(DAY)).toBe(anchor);
    expect(snapshotAnchor('2026-09-04T00:00:00.000Z')).toBe(anchor);
  });

  it('uses created_at when it is within a day of the anchor', () => {
    // MythBusters aiadrt1mKEc: the Sep 4 row was written 2026-09-03 20:17 ET = 2026-09-04 00:17Z.
    const created = '2026-09-04T00:17:00.000Z';
    expect(snapshotTimeMs(DAY, created)).toBe(new Date(created).getTime());
    // and it is EARLIER than the anchor, which is the whole point: the line stops going forward
    expect(snapshotTimeMs(DAY, created)).toBeLessThan(anchor);
    expect(snapshotTimeIso(DAY, created)).toBe('2026-09-04T00:17:00.000Z');
  });

  it('falls back to the anchor when created_at is a backfill import time', () => {
    // The measured tail: +228h, which is an import, not a reading.
    const created = new Date(anchor + 228 * 3_600_000).toISOString();
    expect(snapshotTimeMs(DAY, created)).toBe(anchor);
  });

  it('holds the boundary: exactly a day either side is still the reading', () => {
    expect(snapshotTimeMs(DAY, new Date(anchor + SNAPSHOT_TRUST_MS).toISOString())).toBe(anchor + SNAPSHOT_TRUST_MS);
    expect(snapshotTimeMs(DAY, new Date(anchor - SNAPSHOT_TRUST_MS).toISOString())).toBe(anchor - SNAPSHOT_TRUST_MS);
    expect(snapshotTimeMs(DAY, new Date(anchor + SNAPSHOT_TRUST_MS + 1000).toISOString())).toBe(anchor);
    expect(snapshotTimeMs(DAY, new Date(anchor - SNAPSHOT_TRUST_MS - 1000).toISOString())).toBe(anchor);
  });

  it('keeps the anchor when there is no created_at at all', () => {
    expect(snapshotTimeMs(DAY, null)).toBe(anchor);
    expect(snapshotTimeMs(DAY, undefined)).toBe(anchor);
    expect(snapshotTimeMs(DAY, 'not a date')).toBe(anchor);
  });

  it('reads a Date as happily as a string', () => {
    expect(snapshotTimeMs(new Date(Date.UTC(2026, 8, 4)), new Date(anchor - 3_600_000))).toBe(anchor - 3_600_000);
  });
});
