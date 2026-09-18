jest.mock('next/cache', () => ({ unstable_cache: (fn: any) => fn }));
jest.mock('../admin/db', () => ({ q: jest.fn(async () => []), one: jest.fn(async () => null) }));
jest.mock('./chart-runtime', () => ({ readHybridChart: jest.fn() }));
import { q } from '../admin/db';
import { videoPage } from '../admin/queries';
import { readHybridChart } from './chart-runtime';
import { buildSeriesFile } from './series';

const before = { ...process.env };
afterEach(() => { process.env = { ...before }; jest.clearAllMocks(); });

test('the actual video page consumes the hybrid chart and propagates its status', async () => {
  process.env.SERIES_HYBRID = '1';
  process.env.SERIES_DISABLE = '0';
  (readHybridChart as jest.Mock).mockResolvedValue({ status: 'current', asOf: '2026-09-18T12:00:00Z',
    file: buildSeriesFile({ videoId: 'v', samples: [{ at: '2026-09-18T12:00:00Z', views: 321 }] }) });
  const page = await videoPage('v');
  expect(page.samples.map(p => p.views)).toEqual([321]);
  expect(page).toMatchObject({ chartStatus: 'current', chartAsOf: '2026-09-18T12:00:00Z' });
  expect((q as jest.Mock).mock.calls.some(([sql]) => /\b(rss_samples|view_samples|view_snapshots)\b/.test(sql))).toBe(false);
});

test('an unavailable hybrid chart never silently falls back to raw source tables', async () => {
  process.env.SERIES_HYBRID = '1';
  process.env.SERIES_DISABLE = '0';
  (readHybridChart as jest.Mock).mockResolvedValue({ file: null, status: 'unavailable', asOf: null });
  const page = await videoPage('v');
  expect(page).toMatchObject({ chartStatus: 'unavailable', samples: [], rss: [], snapshots: [] });
  expect((q as jest.Mock).mock.calls.some(([sql]) => /\b(rss_samples|view_samples|view_snapshots)\b/.test(sql))).toBe(false);
});
