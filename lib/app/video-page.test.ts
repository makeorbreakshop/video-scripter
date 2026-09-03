import { heroThumb, verdict } from './video-page';

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

// Invariant 3, reader's half: a video we cannot score says why, in words, rather than
// leaving a blank where the ratio belongs. The causes are lib/scoring/score-gaps.ts.
describe('verdict names the reason there is no score', () => {
  const base = {
    score: null as any, headline: 'day30' as const, pace: null, expectedNow: null,
    views: 1200, ageDays: 2, channelName: 'Jay Clouse',
  };

  // A row with a null baseline: we tried to score it and the channel had nothing to divide by.
  const noBaselineRow = { score: null, baseline: null, est30: 4000, confidence: 'insufficient' } as any;

  it('says the channel has too little history when the row has no baseline', () => {
    const v = verdict({ ...base, score: noBaselineRow, observations: 4 });
    expect(v.big).toBeNull();
    expect(v.under).toContain('Not enough Jay Clouse history yet for a baseline');
    expect(v.under).toContain('1K views');
  });

  it('says the priors are too young when the channel has plenty of prior videos', () => {
    const v = verdict({ ...base, score: noBaselineRow, observations: 4, priorLongform: 12 });
    expect(v.under).toContain('too young to set a baseline');
  });

  it('says a video with no score row at all has simply not been scored yet', () => {
    expect(verdict({ ...base, observations: 4 }).under).toContain('Not scored yet');
  });

  it('says the video has not been measured yet when nothing has been sampled', () => {
    const v = verdict({ ...base, observations: 0 });
    expect(v.under).toContain('No view measurements yet');
  });

  it('still leads with the ratio when there is one', () => {
    const v = verdict({ ...base, score: { score: 2.79, baseline: 6808, est30: 19001, confidence: 'likely' } as any, observations: 9 });
    expect(v.big).toBe('2.8×');
  });
});
