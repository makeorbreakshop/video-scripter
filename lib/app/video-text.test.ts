import { writeVideoText, VIDEO_TEXT_UPSERT_SQL } from './video-text';

const mq = jest.fn().mockResolvedValue([]);
jest.mock('../admin/db', () => ({ q: (...a: any[]) => mq(...a) }));

beforeEach(() => mq.mockClear());

describe('writeVideoText', () => {
  it('is a no-op with nothing to write', async () => {
    await expect(writeVideoText([])).resolves.toBe(0);
    expect(mq).not.toHaveBeenCalled();
  });

  it('sends four parallel arrays, with metadata serialised as jsonb text', async () => {
    await writeVideoText([
      { videoId: 'a', description: 'hi', metadata: { x: 1 }, llmSummary: null },
      { videoId: 'b', description: null, metadata: null, llmSummary: 's' },
    ]);
    expect(mq.mock.calls[0][0]).toBe(VIDEO_TEXT_UPSERT_SQL);
    expect(mq.mock.calls[0][1]).toEqual([
      ['a', 'b'], ['hi', null], ['{"x":1}', null], [null, 's'],
    ]);
  });

  it('upserts rather than failing on a video it has already written', () => {
    expect(VIDEO_TEXT_UPSERT_SQL).toContain('on conflict (video_id) do update');
  });
});
