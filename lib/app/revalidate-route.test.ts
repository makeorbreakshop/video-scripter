// The invalidation endpoint the pipeline scripts call. The secret header is the only auth
// (middleware.ts lists the path as a public API), so these tests pin that gate as much as
// the tags themselves.
const revalidateTag = jest.fn();
jest.mock('next/cache', () => ({ revalidateTag: (t: string) => revalidateTag(t), unstable_cache: (fn: any) => fn }));

import { POST } from '../../app/api/app/revalidate/route';

const post = (body: unknown, secret?: string) =>
  POST(new Request('http://localhost/api/app/revalidate', {
    method: 'POST',
    headers: secret ? { 'content-type': 'application/json', 'x-revalidate-secret': secret } : { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));

const OLD = process.env.REVALIDATE_SECRET;
beforeEach(() => { revalidateTag.mockClear(); process.env.REVALIDATE_SECRET = 's3cret'; });
afterAll(() => { if (OLD === undefined) delete process.env.REVALIDATE_SECRET; else process.env.REVALIDATE_SECRET = OLD; });

it('401s without the secret header', async () => {
  const res = await post({ channels: ['UC1'] });
  expect(res.status).toBe(401);
  expect(revalidateTag).not.toHaveBeenCalled();
});

it('401s on the wrong secret', async () => {
  const res = await post({ channels: ['UC1'] }, 'nope');
  expect(res.status).toBe(401);
  expect(revalidateTag).not.toHaveBeenCalled();
});

it('401s when the server has no secret configured — never open by default', async () => {
  delete process.env.REVALIDATE_SECRET;
  expect((await post({ channels: ['UC1'] }, 'anything')).status).toBe(401);
});

it('400s on unparseable JSON', async () => {
  expect((await post('{nope', 's3cret')).status).toBe(400);
});

it('400s when channels is not a list of ids', async () => {
  expect((await post({ channels: 'UC1' }, 's3cret')).status).toBe(400);
  expect((await post({ channels: [1] }, 's3cret')).status).toBe(400);
  expect((await post({ videos: [{ channelId: 'UC1' }] }, 's3cret')).status).toBe(400);
  expect(revalidateTag).not.toHaveBeenCalled();
});

it('drops the channel tag', async () => {
  const res = await post({ channels: ['UC1', 'UC2'] }, 's3cret');
  expect(res.status).toBe(200);
  expect(revalidateTag.mock.calls.flat()).toEqual(['channel:UC1', 'channel:UC2']);
});

it('drops the video tag and its channel tag together', async () => {
  const res = await post({ videos: [{ id: 'vid1', channelId: 'UC1' }] }, 's3cret');
  expect(res.status).toBe(200);
  expect(revalidateTag.mock.calls.flat()).toEqual(['video:vid1', 'channel:UC1']);
});

it('takes a video without a channel', async () => {
  await post({ videos: [{ id: 'vid1' }] }, 's3cret');
  expect(revalidateTag.mock.calls.flat()).toEqual(['video:vid1']);
});
