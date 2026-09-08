import {
  buildSeriesFile, encodeSeries, decodeSeries, mergeSeriesFiles, seriesKey, seriesRss,
  SERIES_VERSION,
} from './series';

const P = '2026-08-01T00:00:00.000Z';

describe('seriesKey', () => {
  test('one flat key per video', () => {
    expect(seriesKey('KFVqHUvp-0w')).toBe('series/KFVqHUvp-0w.json.gz');
  });
  test('refuses an id that would forge a path', () => {
    expect(() => seriesKey('a/b')).toThrow();
    expect(() => seriesKey('')).toThrow();
  });
});

describe('buildSeriesFile', () => {
  test('sorts every series and normalises times, whatever order the rows arrive in', () => {
    const f = buildSeriesFile({
      videoId: 'v1', publishedAt: P, builtAt: P,
      samples: [{ at: '2026-08-03T00:00:00Z', views: '30' }, { at: new Date('2026-08-02T00:00:00Z'), views: 20 }],
      thumbs: [{ version: 2, first_seen: '2026-08-04T00:00:00Z' }, { version: 1, first_seen: P }],
    });
    expect(f.samples.map((s) => s.views)).toEqual([20, 30]);
    expect(f.samples[0].at).toBe('2026-08-02T00:00:00.000Z');
    expect(f.thumbs.map((t) => t.version)).toEqual([1, 2]);
    expect(f.v).toBe(SERIES_VERSION);
  });

  test('drops rows with no usable clock rather than dating them to 1970', () => {
    const f = buildSeriesFile({ videoId: 'v1', samples: [{ at: null, views: 5 }, { at: P, views: 6 }] });
    expect(f.samples).toHaveLength(1);
  });

  test('an rss row with no model_eligible column is treated as usable', () => {
    const f = buildSeriesFile({ videoId: 'v1', rss: [{ at: P, views: 1 }] });
    expect(f.rss[0].eligible).toBe(true);
    expect(f.rss[0].conflicted).toBe(false);
  });

  test('two builds of the same rows are byte identical', () => {
    const a = buildSeriesFile({ videoId: 'v1', publishedAt: P, builtAt: P, rss: [{ at: P, views: 1, model_eligible: true }] });
    const b = buildSeriesFile({ videoId: 'v1', publishedAt: P, builtAt: P, rss: [{ at: P, views: 1, model_eligible: true }] });
    expect(encodeSeries(a).equals(encodeSeries(b))).toBe(true);
  });
});

describe('seriesRss', () => {
  const f = buildSeriesFile({
    videoId: 'v1', publishedAt: P,
    rss: [
      { at: '2026-08-02T00:00:00Z', views: 10, model_eligible: true, conflicted: false },
      { at: '2026-08-03T00:00:00Z', views: 20, model_eligible: false, conflicted: false },
      { at: '2026-08-04T00:00:00Z', views: null, model_eligible: true, conflicted: false },
      { at: '2026-08-05T00:00:00Z', views: 40, model_eligible: true, conflicted: true },
    ],
  });
  test("the page's predicate is views is not null and not conflicted", () => {
    expect(seriesRss(f, 'page').map((r) => r.views)).toEqual([10, 20]);
  });
  test("the model's predicate is model_eligible and not conflicted", () => {
    expect(seriesRss(f, 'model').map((r) => r.views)).toEqual([10, null]);
  });
  test('the two predicates are not the same predicate', () => {
    expect(seriesRss(f, 'page')).not.toEqual(seriesRss(f, 'model'));
  });
});

describe('encode / decode', () => {
  const f = buildSeriesFile({ videoId: 'v1', publishedAt: P, samples: [{ at: P, views: 1 }] });
  test('round trips', () => {
    expect(decodeSeries(encodeSeries(f))).toEqual(f);
  });
  test('gzip is worth it on a realistic series', () => {
    const big = buildSeriesFile({
      videoId: 'v1', publishedAt: P,
      rss: Array.from({ length: 2000 }, (_, i) => ({ at: new Date(Date.parse(P) + i * 3.6e6).toISOString(), views: 1000 + i })),
    });
    const gz = encodeSeries(big).length;
    expect(gz).toBeLessThan(JSON.stringify(big).length / 4);
  });
  test('garbage is a miss, not a throw', () => {
    expect(decodeSeries(Buffer.from('not gzip'))).toBeNull();
  });
  test('a future version is a miss, not a wrong answer', () => {
    const bumped = { ...f, v: 99 } as unknown as typeof f;
    expect(decodeSeries(encodeSeries(bumped))).toBeNull();
  });
});

describe('mergeSeriesFiles', () => {
  test('the archive fills the holes Postgres was thinned into, without duplicating the overlap', () => {
    const fromPg = buildSeriesFile({ videoId: 'v1', publishedAt: P, builtAt: P,
      rss: [{ at: '2026-08-02T00:00:00Z', views: 10 }, { at: '2026-08-04T00:00:00Z', views: 30 }] });
    const fromR2 = buildSeriesFile({ videoId: 'v1', publishedAt: P, builtAt: '2026-08-09T00:00:00Z',
      rss: [{ at: '2026-08-02T00:00:00Z', views: 10 }, { at: '2026-08-03T00:00:00Z', views: 20 },
            { at: '2026-08-04T00:00:00Z', views: 30 }] });
    const m = mergeSeriesFiles(fromPg, fromR2);
    expect(m.rss.map((r) => r.views)).toEqual([10, 20, 30]);
    expect(m.built_at).toBe('2026-08-09T00:00:00.000Z');
  });
});
