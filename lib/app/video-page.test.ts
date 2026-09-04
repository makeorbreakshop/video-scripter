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

// ------------------------------------------------------------- the header ----

import { headerLines } from './video-page';

describe('headerLines: one metadata line and one verdict line, and the views are said once', () => {
  const young = {
    id: 'Po_Dh7WLgmM',
    title: 'The Most Overhyped and Underhyped New AI Models',
    channelId: 'UCx', channelName: 'Matt Wolfe',
    publishedAt: '2026-09-03T02:14:55.000Z',
    views: 83_722,
    ageDays: 1.4,
    headline: 'day30' as const,
    pace: null, expectedNow: null,
    score: { score: 2.02, baseline: 92_000, est30: 186_000, confidence: 'early' } as any,
    observations: 40,
  };

  it('puts the channel, the ET publish time, the age, the exact views and the link in the metadata', () => {
    const h = headerLines(young);
    expect(h.meta.channelName).toBe('Matt Wolfe');
    expect(h.meta.publishedET).toBe('Sep 2, 10:14 PM');   // ET, not UTC
    expect(h.meta.age).toBe('1d old');
    expect(h.meta.views).toBe('83,722');
    expect(h.meta.youtubeUrl).toBe('https://youtu.be/Po_Dh7WLgmM');
  });

  it('says what typical means -- typical AT THIS AGE, then the day-30 projection', () => {
    const h = headerLines(young);
    expect(h.big).toBe('2.0×');
    expect(h.over).toBe(true);
    // v5's denominator is C(t). Without the age on the line the number reads as a day-30
    // claim sitting next to a day-30 projection, which is the one thing it is not.
    expect(h.verdict).toBe('typical 92K at 1d old · on pace for 186K by day 30 · early read');
  });

  it('never repeats the view count in the verdict line for a young video', () => {
    // "84K views at 35h" was the metadata line said twice.
    const h = headerLines(young);
    expect(h.verdict).not.toMatch(/views/);
    expect(h.verdict).not.toMatch(/84K|83,722/);
  });

  it('reads a video past day 30 as where it is now', () => {
    const h = headerLines({
      ...young, ageDays: 290, headline: 'now', views: 565_000,
      pace: 0.948, expectedNow: 596_000,
      score: { score: 0.9, baseline: 596_000, est30: 540_000, confidence: 'confirmed' } as any,
    });
    expect(h.big).toBe('0.9×');
    expect(h.over).toBe(false);
    expect(h.verdict).toBe('565K vs typical 596K by now · settled');
  });

  it('keeps the confidence word when the read is not settled yet', () => {
    const h = headerLines({
      ...young, ageDays: 40, headline: 'now', views: 565_000, pace: 1.2, expectedNow: 470_000,
      score: { score: 1.2, baseline: 470_000, est30: 500_000, confidence: 'likely' } as any,
    });
    expect(h.verdict).toBe('565K vs typical 470K by now · likely read');
  });

  it('says why there is no number instead of leaving the line blank', () => {
    const h = headerLines({ ...young, score: null as any, observations: 0 });
    expect(h.big).toBeNull();
    expect(h.verdict).toContain('No view measurements yet');
    expect(h.verdict).not.toMatch(/83,722|84K views/);
  });

  it('is two lines and only two', () => {
    const h = headerLines(young);
    expect(Object.keys(h).sort()).toEqual(['big', 'meta', 'over', 'verdict']);
    expect(h.verdict.split('\n')).toHaveLength(1);
  });
});
