import fixture from '../../docs/audits/2026-09-04-v5-chart-fixture.json';
import { mergeObservations } from '../scoring/observations';
import { buildSeries } from './chart-series';
import { chartRows, legendEntries, tooltipLines } from './chart-style';
import { scoreComparison } from './chart-comparison';
import { headerLines, loadVideoPage } from './video-page';
import { videoPage } from '../admin/queries';

jest.mock('../admin/queries', () => ({ videoPage: jest.fn() }));
const data: any = fixture;
const params = data.params.params;
const capturedAt = Date.parse(data.capturedAt);

function scenario(id: string) {
  const video = data.videos.find((v: any) => v.id === id);
  const score = data.scores.find((s: any) => s.video_id === id);
  const own = (key: string) => data[key].filter((s: any) => s.video_id === id).map((s: any) => ({ ...s, views: Number(s.views) }));
  const snapshots = own('snapshots').map((s: any) => ({ ...s, at: `${s.snapshot_date.slice(0, 10)}T12:00:00.000Z` }));
  const actuals = mergeObservations(video.published_at, snapshots, own('samples'), own('rss'), capturedAt);
  const series = buildSeries({ actuals, baseline: Number(score.baseline), est30: Number(score.est30), mult: params.mult, longtail: params.longtail, horizonDay: 7 });
  return { video, score, actuals, series, snapshots, samples: own('samples'), rss: own('rss') };
}

describe.each<[string, string]>(data.videos.map((v: any) => [v.channel_name, v.id]))('%s frozen chart', (_name, id) => {
  it('preserves the current canonical observations and reconstructs a bounded past', () => {
    const { series, actuals } = scenario(id);
    expect(series[0].views).toBe(0);
    for (const actual of actuals) expect(series.find(p => p.day === actual.day)).toMatchObject({ day: actual.day, views: actual.views, kind: 'measured' });
    const past = series.filter(p => p.day < actuals[0].day);
    past.forEach((p, i) => {
      expect(p.views).toBeLessThanOrEqual(actuals[0].views);
      if (i) expect(p.views).toBeGreaterThanOrEqual(past[i - 1].views);
    });
  });
  it('never draws estimated neighbors as measured, and adds no unvalidated forecast ribbon', () => {
    const { series, actuals } = scenario(id);
    const rows = chartRows(series, [], actuals);
    for (const row of rows) {
      if (row.day < actuals[0].day || row.day > actuals.at(-1)!.day) expect(row.views).toBeUndefined();
      expect(row.bandInner).toBeUndefined();
    }
  });
  it('composes the page with scorer timestamps and the exact stored comparison only', async () => {
    const s = scenario(id);
    jest.mocked(videoPage).mockResolvedValue({ ...s, thumbs: [], titles: [], mult: params.mult, longtail: params.longtail, bands: null } as any);
    const view = await loadVideoPage(id, capturedAt);
    expect(view!.actuals).toEqual(s.actuals);
    expect(view!.curve).toEqual([]);
    expect(view!.comparison).toEqual(scoreComparison(s.score));
    const comparison = view!.comparison;
    if (comparison) {
      expect(comparison.day).toBe(Number(s.score.age_days));
      expect(comparison.views / comparison.typical).toBeCloseTo(comparison.score, 5);
    } else expect(s.score.score).toBeNull();
  });
});

test('V5 same-age headline survives day 30 and reports the scored age when newer views exist', () => {
  const h = headerLines({ id: 'v', publishedAt: '2026-01-01', channelName: 'Channel', views: 900, ageDays: 80,
    headline: 'now', pace: 99, expectedNow: 10,
    score: { model_version: 'v5.1-rss', score: 2, age_days: 60, views: 800, typical_at_age: 400, baseline: 200, est30: 300, confidence: 'confirmed' } as any });
  expect(h.big).toBe('2.0×');
  expect(h.verdict).toContain('60d old');
  expect(h.verdict).toContain('comparison used 800 views');
  expect(h.verdict).not.toContain('by day 30');
});

test('withheld or inconsistent comparisons cannot produce a multiplier marker', () => {
  expect(scoreComparison({ model_version: 'v5.1-rss', score: null, age_days: .1, views: 1000, typical_at_age: 500 })).toBeNull();
  expect(scoreComparison({ model_version: 'v5.1-rss', score: 4, age_days: 3, views: 1000, typical_at_age: 500 })).toBeNull();
});

test('projection disclosure has no ribbon swatch without a validated interval', () => {
  expect(legendEntries({ forecast: true }, false)).toEqual([{ key: 'forecast', label: 'tentative projection', swatch: 'projection', ribbon: false }]);
  expect(tooltipLines({ kind: 'interpolated', at: '2026-09-04', views: 100 })).toContain('Interpolated between observations');
});
