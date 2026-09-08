import {
  metricsFor, buildScorecard, sizeBucket, packagingBucket, bucketForAge, median,
  type ScorecardRow,
} from './scorecard';

const row = (o: Partial<ScorecardRow> = {}): ScorecardRow => ({
  videoId: 'v', t: 1, ageDays: 1, est30: 1000, actual30: 1000, score: 1, baseline: 1000,
  confidence: 'early', typicalKind: 'measured', subscribers: 50_000, changedAfter: false, ...o,
});

describe('metricsFor', () => {
  it('is zero error when the forecast was right', () => {
    const m = metricsFor([row(), row({ videoId: 'w' })]);
    expect(m.n).toBe(2);
    expect(m.medALE).toBe(0);
    expect(m.bias).toBe(0);
  });

  it('signs the bias: forecasting high is positive', () => {
    const m = metricsFor([row({ est30: 2000, actual30: 1000 })]);
    expect(m.bias).toBeCloseTo(Math.log(2));
    expect(m.medALE).toBeCloseTo(Math.log(2));
  });

  it('drops rows with no outcome rather than counting them as perfect', () => {
    expect(metricsFor([row({ actual30: 0 }), row({ est30: 0 })]).n).toBe(0);
  });

  it('grades the 2x call against the same baseline the call used', () => {
    const rows = [
      row({ videoId: 'a', score: 3, actual30: 5000, baseline: 1000 }),  // called, true  -> tp
      row({ videoId: 'b', score: 3, actual30: 1000, baseline: 1000 }),  // called, false -> fp
      row({ videoId: 'c', score: 1, actual30: 5000, baseline: 1000 }),  // missed        -> fn
      row({ videoId: 'd', score: 1, actual30: 1000, baseline: 1000 }),  // quiet, true   -> tn
    ];
    const m = metricsFor(rows);
    expect([m.tp, m.fp, m.fn]).toEqual([1, 1, 1]);
    expect(m.precision).toBeCloseTo(0.5);
    expect(m.recall).toBeCloseTo(0.5);
    expect(m.f1).toBeCloseTo(0.5);
    expect(m.nCallable).toBe(4);
  });

  it('counts a row with no baseline in n but not in the call', () => {
    const m = metricsFor([row({ baseline: null, score: null })]);
    expect(m.n).toBe(1);
    expect(m.nCallable).toBe(0);
    expect(m.precision).toBeNull();
    expect(m.f1).toBeNull();
  });
});

describe('buckets', () => {
  it('bands channels the way the product talks about them', () => {
    expect(sizeBucket(0)).toBe('<1K');
    expect(sizeBucket(999)).toBe('<1K');
    expect(sizeBucket(1_000)).toBe('1K–10K');
    expect(sizeBucket(999_999)).toBe('100K–1M');
    expect(sizeBucket(1_000_000)).toBe('1M+');
    expect(sizeBucket(null)).toBe('unknown');
  });

  it('does not call missing packaging coverage "no change"', () => {
    // Before 2026-09-01 a thumbnail swap left no record; calling that no_change would invent
    // a control group out of blindness.
    expect(packagingBucket(null)).toBe('unknown');
    expect(packagingBucket(false)).toBe('no_change');
    expect(packagingBucket(true)).toBe('changed');
  });

  it('assigns an age to the nearest bucket inside the benchmark tolerance', () => {
    expect(bucketForAge(0.6)).toBe(0.5);
    expect(bucketForAge(1.2)).toBe(1);
    expect(bucketForAge(6)).toBe(5);      // equidistant from 5 and 7; the lower bucket wins
    expect(bucketForAge(6.5)).toBe(7);
    expect(bucketForAge(22)).toBeNull();  // nothing is within 3 days of 14
  });

  it('never assigns a sub-day age to the day-1 bucket by way of a wide tolerance', () => {
    expect(bucketForAge(0.25)).toBe(0.5);
  });
});

describe('buildScorecard', () => {
  const rows = [
    row({ videoId: 'a', t: 1, subscribers: 500, confidence: 'early', typicalKind: 'estimated' }),
    row({ videoId: 'b', t: 7, subscribers: 5_000_000, confidence: 'confirmed', typicalKind: 'measured', changedAfter: true }),
    row({ videoId: 'c', t: 7, subscribers: null, confidence: null, typicalKind: null, changedAfter: null }),
  ];

  it('cuts the same rows every declared way', () => {
    const cells = buildScorecard(rows);
    const dims = new Set(cells.map((c) => c.dimension));
    expect(dims).toEqual(new Set(['age', 'channel_size', 'confidence', 'typical_kind', 'packaging']));
    const total = cells.filter((c) => c.dimension === 'age').reduce((a, c) => a + c.metrics.n, 0);
    expect(total).toBe(3);
  });

  it('prints ages in ascending order, not alphabetically', () => {
    const many = [0.5, 1, 2, 3, 5, 7, 14].map((t, i) => row({ videoId: `v${i}`, t }));
    expect(buildScorecard(many).filter((c) => c.dimension === 'age').map((c) => c.bucket))
      .toEqual(['0.5', '1', '2', '3', '5', '7', '14']);
  });

  it('keeps unknown last rather than sorting it into the middle', () => {
    expect(buildScorecard(rows).filter((c) => c.dimension === 'typical_kind').map((c) => c.bucket))
      .toEqual(['measured', 'estimated', 'unknown']);
  });
});

describe('median', () => {
  it('averages the middle pair on an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('is null on nothing', () => {
    expect(median([])).toBeNull();
  });
});
