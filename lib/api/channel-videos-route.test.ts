jest.mock('@/lib/admin/db', () => ({ q: jest.fn(), one: jest.fn() }));
jest.mock('@/lib/api/v1', () => ({
  withApiKey: (fn: any) => fn,
  jsonError: jest.fn(),
  intParam: jest.requireActual('@/lib/api/v1').intParam,
  scoreShape: jest.fn(() => null),
}));
import { q } from '@/lib/admin/db';
import { GET } from '@/app/api/v1/channels/[id]/videos/route';

const CH = 'UCiDJtJKMICpb9B1qf7qjEOA';
const call = (qs: string) =>
  (GET as any)(new Request(`https://example.test/api/v1/channels/${CH}/videos${qs}`), {}, { params: Promise.resolve({ id: CH }) });

beforeEach(() => (q as jest.Mock).mockReset().mockResolvedValue([
  { id: 'aaaaaaaaaaa', title: 'Stream', was_live: true, is_short: false },
  { id: 'bbbbbbbbbbb', title: 'Video', was_live: null, is_short: false },
]));

test('offset pages past the limit and is echoed back', async () => {
  const body = await (await call('?limit=200&offset=400')).json();
  const [sql, params] = (q as jest.Mock).mock.calls[0];
  expect(sql).toContain('limit $2 offset $3');
  expect(params.slice(0, 3)).toEqual([CH, 200, 400]);
  expect(body.offset).toBe(400);
});

test('offset is capped and defaults to 0', async () => {
  await call('?offset=999999');
  expect((q as jest.Mock).mock.calls[0][1][2]).toBe(5000);
  (q as jest.Mock).mockClear();
  await call('');
  expect((q as jest.Mock).mock.calls[0][1][2]).toBe(0);
});

test('every video carries was_live, false when unknown', async () => {
  const body = await (await call('')).json();
  expect(body.videos.map((v: any) => v.was_live)).toEqual([true, false]);
});

test('exclude_live adds the past-stream filter; default leaves it out', async () => {
  await call('?exclude_live=1');
  expect((q as jest.Mock).mock.calls[0][0]).toContain("and not coalesce((coalesce(vt.metadata, v.metadata)->'live_streaming_details' ? 'actualStartTime'), false)");
  (q as jest.Mock).mockClear();
  await call('');
  expect((q as jest.Mock).mock.calls[0][0]).not.toContain('and not coalesce(');
});

test('since/until bind after offset', async () => {
  await call('?since=2026-01-01&until=2026-06-01');
  const [sql, params] = (q as jest.Mock).mock.calls[0];
  expect(sql).toContain('v.published_at >= $4::timestamptz');
  expect(sql).toContain('v.published_at <= $5::timestamptz');
  expect(params).toEqual([CH, 50, 0, '2026-01-01', '2026-06-01']);
});
