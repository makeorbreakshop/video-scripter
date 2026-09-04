jest.mock('@/lib/admin/db', () => ({ q: jest.fn(), one: jest.fn() }));
jest.mock('@/lib/api/v1', () => ({ withApiKey: (fn: any) => fn, jsonError: jest.fn() }));
jest.mock('@/lib/thumbs/storage', () => ({ thumbUrl: jest.fn() }));
import { q, one } from '@/lib/admin/db';
import { GET } from '@/app/api/v1/videos/[id]/route';

test('public video API returns RSS beside API readings, sorted and with the latest retained', async () => {
  (one as jest.Mock).mockImplementation((sql: string) => Promise.resolve(sql.includes('from videos v') ? {
    id: 'abcdefghijk', published_at: '2026-08-01T00:00:00Z', channel_id: 'channel',
  } : null));
  (q as jest.Mock).mockImplementation((sql: string) => Promise.resolve(sql.includes('from rss_samples') ? [
    { at: '2026-08-01T05:15:00Z', views: 120, source: 'rss' },
    { at: '2026-08-01T05:00:00Z', views: 100, source: 'sample' },
  ] : []));
  const response = await (GET as any)(new Request('https://example.test'), {}, { params: Promise.resolve({ id: 'abcdefghijk' }) });
  const body = await response.json();
  expect(body.curve.map((p: any) => [p.views, p.source])).toEqual([[100, 'sample'], [120, 'rss']]);
  expect((q as jest.Mock).mock.calls.find(([sql]) => sql.includes('from rss_samples'))[0]).toContain('order by at desc limit 2000');
});
