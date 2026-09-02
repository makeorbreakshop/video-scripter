import { heroThumb } from './video-page';

const R2 = 'https://thumbs.example';
beforeEach(() => { process.env.NEXT_PUBLIC_THUMBS_BASE_URL = R2; });

describe('heroThumb', () => {
  const yt = 'https://i.ytimg.com/vi/XplV_L7gx6w/hqdefault.jpg';
  it('serves the latest archived version from R2 when it was uploaded, with YouTube as the fallback', () => {
    const out = heroThumb('XplV_L7gx6w', [{ version: 1, r2_uploaded_at: '2026-09-01T00:00:00Z' }], yt);
    expect(out).toEqual({ src: `${R2}/XplV_L7gx6w_v1.jpg`, fallback: yt });
  });
  it('goes straight to YouTube when the latest version never reached R2', () => {
    const out = heroThumb('XplV_L7gx6w', [{ version: 1, r2_uploaded_at: null }], yt);
    expect(out).toEqual({ src: yt, fallback: null });
  });
  it('uses the newest uploaded version, not just the newest row', () => {
    const out = heroThumb('v', [
      { version: 1, r2_uploaded_at: '2026-09-01T00:00:00Z' },
      { version: 2, r2_uploaded_at: null },
    ], yt);
    // v2 is the live thumbnail; YouTube shows it. R2 only has v1, which is stale.
    expect(out).toEqual({ src: yt, fallback: `${R2}/v_v1.jpg` });
  });
  it('derives the YouTube URL from the id when the row has none', () => {
    expect(heroThumb('abc', [], null)).toEqual({ src: 'https://i.ytimg.com/vi/abc/hqdefault.jpg', fallback: null });
  });
});
