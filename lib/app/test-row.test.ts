import { buildTestRow, dayRange, etDayShort, rowMeta, sortTestRows, times, type ThumbRowWithUrl } from './test-row';

// Real shape: thumbnail_versions is a state log, so a rotation back writes a new version with
// the same bytes. Times are UTC here; the row's words come out in ET (Brandon's timezone).
const row = (version: number, sha: string, first_seen: string): ThumbRowWithUrl =>
  ({ version, sha256: sha, phash: null, first_seen, url: `/t/${version}.jpg` });

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 3, h, m)).toISOString();

const base = {
  videoId: 'k3Q9UWWiPsQ',
  title: 'The "Perpetual Motion" Pump That Actually Works',
  channelId: 'UCsm', channelName: 'Steve Mould',
  publishedAt: new Date(Date.UTC(2026, 7, 31, 16, 0)).toISOString(),
  views: 2_300_000, score: 1.42,
};

describe('formatters', () => {
  it('renders an ET calendar day, not the UTC one', () => {
    // 03:30 UTC on Sep 3 is still Sep 2 in New York.
    expect(etDayShort(new Date(Date.UTC(2026, 8, 3, 3, 30)).toISOString())).toBe('Sep 2');
  });
  it('collapses a range that starts and ends on one day', () => {
    expect(dayRange(T(12), T(19))).toBe('Sep 3');
    expect(dayRange(new Date(Date.UTC(2026, 7, 30, 16)).toISOString(), T(19))).toBe('Aug 30 – Sep 3');
  });
  it('writes scores as multiples with a times sign', () => {
    expect(times(1.42)).toBe('1.4×');
    expect(times(12.3)).toBe('12×');
    expect(times(null)).toBeNull();
  });
  it('builds the left column line', () => {
    expect(rowMeta(base)).toBe('Aug 31 · 2.3M views · 1.4×');
  });
  it('drops the parts it does not have', () => {
    expect(rowMeta({ publishedAt: null, views: null, score: null })).toBe('');
  });
});

describe('buildTestRow', () => {
  it('is null when the video has only ever worn one thumbnail', () => {
    expect(buildTestRow({ ...base, thumbs: [row(1, 'a', T(9))] }, T(16))).toBeNull();
  });

  it('reads a live rotation as one experiment, counting thumbnails and never rotations', () => {
    const thumbs = [row(2, 'ram', T(12)), row(3, 'fake', T(13, 40)), row(4, 'ram', T(15, 21))];
    const r = buildTestRow({ ...base, thumbs }, T(16))!;
    expect(r.status).toBe('testing');
    expect(r.pill).toBe('ROTATING');
    expect(r.headline).toBe('2 thumbnails');
    expect(r.variants.map((v) => v.label)).toEqual(['A', 'B']);
    // A is current: the last state rotated back to it. Never labelled "live now".
    expect(r.variants.find((v) => v.current)?.label).toBe('A');
    expect(r.stamp).toBe('detected Sep 3 · 11:21 AM ET');
    expect(r.expandable).toBe(true);
    expect(r.href).toBe('/app/videos/k3Q9UWWiPsQ');
    expect(r.headline).not.toMatch(/rotation|%|share/i);
  });

  it('names the image it kept and the range once a variant has held 48h, dropped one first', () => {
    const thumbs = [row(1, 'a', T(9)), row(2, 'b', T(10)), row(3, 'a', T(11)), row(4, 'b', T(12))];
    const r = buildTestRow({ ...base, thumbs }, new Date(Date.UTC(2026, 8, 6, 12)).toISOString())!;
    expect(r.status).toBe('settled');
    expect(r.pill).toBe('SETTLED');
    expect(r.headline).toBe('kept B');
    expect(r.after?.label).toBe('B');
    expect(r.before?.label).toBe('A');
    expect(r.stamp).toBe('rotated Sep 3 – Sep 5');
    expect(r.expandable).toBe(true);
  });

  it('reads one image that never came back as a swap, with the time after publish', () => {
    const published = new Date(Date.UTC(2026, 8, 3, 13, 49)).toISOString();
    const thumbs = [row(1, 'a', published), row(2, 'b', T(17, 49))];
    const r = buildTestRow({ ...base, publishedAt: published, thumbs }, T(18))!;
    expect(r.status).toBe('swap');
    expect(r.pill).toBe('SWAP');
    expect(r.headline).toBe('New thumbnail');
    expect(r.stamp).toBe('Sep 3 · 1:49 PM ET · 4h after publish');
    // A swap is not a test: there are no variants to open.
    expect(r.expandable).toBe(false);
    expect(r.before?.label).toBe('A');
    expect(r.after?.label).toBe('B');
  });

  it('carries the archived url of the state that first showed each image', () => {
    const thumbs = [row(2, 'ram', T(12)), row(3, 'fake', T(13)), row(4, 'ram', T(14))];
    const r = buildTestRow({ ...base, thumbs }, T(16))!;
    expect(r.variants.map((v) => v.url)).toEqual(['/t/2.jpg', '/t/3.jpg']);
  });

  it('sorts rows newest activity first', () => {
    const a = buildTestRow({ ...base, videoId: 'a', thumbs: [row(1, 'a', T(9)), row(2, 'b', T(10))] }, T(16))!;
    const b = buildTestRow({ ...base, videoId: 'b', thumbs: [row(1, 'a', T(9)), row(2, 'b', T(14))] }, T(16))!;
    expect(sortTestRows([a, b]).map((r) => r.videoId)).toEqual(['b', 'a']);
  });
});
