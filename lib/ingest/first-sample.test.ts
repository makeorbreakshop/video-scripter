// Invariant 4: a video gets its first stats sample the moment it is ingested.
//
// RSS discovers a video 1-2 days after publish; before this, the importer wrote only a daily
// view_snapshots row and the first view_samples row waited for the next tracker tick — so a
// late-found video's chart had nothing measured for its first day of OUR knowledge either.
// The videos.list response is already in hand at import, so it is written as a sample too.
import { ingestWrites, firstSampleWrite } from './first-sample';

const ITEM = {
  id: 'XplV_L7gx6w',
  snippet: { publishedAt: '2026-08-29T11:12:40Z', title: 'I Built 2 Coffee Tables in 8 Hours', channelId: 'UCM' },
  statistics: { viewCount: '816558', likeCount: '20100', commentDount: '0', commentCount: '512' },
};
const AT = new Date('2026-09-01T16:51:47.269Z');

describe('an ingested video has a view_samples row at insert time', () => {
  it('writes a sample carrying the counts from the videos.list response', () => {
    const w = firstSampleWrite(ITEM, AT);
    expect(w).not.toBeNull();
    expect(w!.sql).toMatch(/insert into view_samples/);
    expect(w!.params).toEqual(['XplV_L7gx6w', AT, 816558, 20100, 512]);
  });

  it('is idempotent — re-ingesting the same video does not fight the tracker', () => {
    expect(firstSampleWrite(ITEM, AT)!.sql).toMatch(/on conflict do nothing/);
  });

  it('the import writes the sample alongside the snapshot and the tracking row', () => {
    const tables = ingestWrites(ITEM, 1, AT).map((w) => /insert into (\w+)/.exec(w.sql)![1]);
    expect(tables).toContain('view_samples');
    expect(tables).toContain('view_snapshots');
    expect(tables).toContain('view_tracking_priority');
  });

  it('missing or junk statistics clamp to zero rather than writing NaN', () => {
    const w = firstSampleWrite({ id: 'x', snippet: { publishedAt: '2026-08-29T11:12:40Z' }, statistics: {} }, AT)!;
    expect(w.params).toEqual(['x', AT, 0, 0, 0]);
    const junk = firstSampleWrite({ id: 'x', snippet: { publishedAt: '2026-08-29T11:12:40Z' }, statistics: { viewCount: 'abc' } }, AT)!;
    expect(junk.params[2]).toBe(0);
  });

  it('skips a video with no id rather than writing an orphan sample', () => {
    expect(firstSampleWrite({ snippet: {}, statistics: { viewCount: '5' } }, AT)).toBeNull();
  });

  it('every write is parameterised — no interpolated statistics', () => {
    for (const w of ingestWrites(ITEM, 1, AT)) expect(w.sql).not.toMatch(/816558/);
  });
});
