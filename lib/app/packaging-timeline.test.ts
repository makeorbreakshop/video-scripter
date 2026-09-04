import { buildTimeline, nowLabel, timelineTicks } from './packaging-timeline';
import type { ThumbRowWithUrl } from './test-row';

const th = (version: number, sha: string, first_seen: string): ThumbRowWithUrl =>
  ({ version, sha256: sha, phash: null, first_seen, url: `/t/${version}.jpg` });
const ti = (version: number, title: string, first_seen: string) => ({ version, title, first_seen });

const D = (day: number, h = 12) => new Date(Date.UTC(2026, 7, day, h)).toISOString();

describe('buildTimeline', () => {
  it('is empty without a thumbnail history', () => {
    expect(buildTimeline({ publishedAt: D(30), thumbs: [], titles: [] })).toEqual([]);
  });

  // Matt Wolfe's GPT-6 video, 18 hours old, one thumbnail and one title: the strip drew a
  // PUBLISHED card and a NOW card carrying the same image and the same words, side by side,
  // which reads as a change and asks the reader to spot the difference between two identical
  // pictures. There is one thing to say and it takes one card.
  it('says "no changes since publish" once when nothing has changed', () => {
    const clips = buildTimeline({
      publishedAt: D(30), thumbs: [th(1, 'a', D(30))], titles: [ti(1, 'GPT-6 Astra Is Finally Here', D(30))],
      score: 1.4, now: D(30, 18),
    });
    expect(clips.map((c) => c.kind)).toEqual(['unchanged']);
    expect(clips[0].url).toBe('/t/1.jpg');            // the thumbnail stays
    expect(clips[0].title).toBe('GPT-6 Astra Is Finally Here');
    expect((clips[0] as any).label).toBe('no changes since publish');
    expect(clips[0].at).toBe(D(30));
  });

  it('keeps the published/…/now layout the moment anything did change', () => {
    const thumbs = [th(1, 'a', D(30)), th(2, 'b', D(31))];
    const clips = buildTimeline({ publishedAt: D(30), thumbs, titles: [ti(1, 'x', D(30))], now: D(31, 18) });
    expect(clips.map((c) => c.kind)).toEqual(['published', 'swap', 'now']);
  });

  it('is a full layout for a title change with one thumbnail', () => {
    const clips = buildTimeline({
      publishedAt: D(30), thumbs: [th(1, 'a', D(30))],
      titles: [ti(1, 'before', D(30)), ti(2, 'after', D(31))], now: D(31, 18),
    });
    expect(clips.map((c) => c.kind)).toEqual(['published', 'title', 'now']);
  });

  it('collapses an A/B/A rotation into one TEST clip, not three thumbnail clips', () => {
    // Rex Krueger v2jtQ96A2_Q shape: A, B, A over two days, settled by the time we look.
    const thumbs = [th(1, 'a', D(30)), th(2, 'b', D(30, 14)), th(3, 'a', D(31))];
    const clips = buildTimeline({ publishedAt: D(30), thumbs, titles: [ti(1, 'I Agreed To This?', D(30))], now: D(5 + 30) });
    expect(clips.map((c) => c.kind)).toEqual(['published', 'test', 'now']);
    const test = clips[1] as any;
    expect(test.headline).toBe('2 thumbnails · A won');
    expect(test.variants.map((v: any) => v.label)).toEqual(['A', 'B']);
    // Hovering the one clip lights every thumbnail marker it covers.
    expect(test.markerKeys).toEqual(['thumb-2', 'thumb-3']);
    expect(test.headline).not.toMatch(/rotation|%/i);
  });

  it('leaves a running test without a winner', () => {
    const thumbs = [th(1, 'a', D(30)), th(2, 'b', D(30, 14)), th(3, 'a', D(30, 16))];
    const clips = buildTimeline({ publishedAt: D(30), thumbs, titles: [], now: D(30, 18) });
    expect((clips[1] as any).headline).toBe('2 thumbnails');
  });

  it('keeps a one-way change as a SWAP clip, never a test', () => {
    const thumbs = [th(1, 'a', D(30)), th(2, 'b', D(31))];
    const clips = buildTimeline({ publishedAt: D(30), thumbs, titles: [], now: D(31, 18) });
    expect(clips.map((c) => c.kind)).toEqual(['published', 'swap', 'now']);
    // The clip carries the WORD and the INSTANT; the strip writes the time in the reader's own
    // zone (components/app/packaging-timeline.tsx), so no zone crosses from the server.
    expect((clips[1] as any).label).toBe('SWAP');
    expect((clips[1] as any).at).toBe(D(31));
    expect(clips.map((c: any) => c.label).join(' ')).not.toMatch(/\bET\b/);
  });

  it('interleaves title changes in time order and shows the image worn then', () => {
    const thumbs = [th(1, 'a', D(30)), th(2, 'b', D(31))];
    const titles = [ti(1, 'first', D(30)), ti(2, 'second', D(31, 20))];
    const clips = buildTimeline({ publishedAt: D(30), thumbs, titles, now: D(32) });
    expect(clips.map((c) => c.kind)).toEqual(['published', 'swap', 'title', 'now']);
    const title = clips[2] as any;
    expect(title.title).toBe('second');
    expect(title.url).toBe('/t/2.jpg');       // the thumbnail live when the title changed
    expect(title.markerKeys).toEqual(['title-2']);
  });

  it('ends on NOW carrying the current image, title and score', () => {
    const thumbs = [th(1, 'a', D(30)), th(2, 'b', D(31))];
    const clips = buildTimeline({ publishedAt: D(30), thumbs, titles: [ti(1, 'x', D(30))], score: 1.24, now: D(32) });
    const now = clips[clips.length - 1] as any;
    expect(now.kind).toBe('now');
    expect(now.url).toBe('/t/2.jpg');
    expect(nowLabel(now.score)).toBe('NOW · 1.2×');
  });
});

describe('timelineTicks', () => {
  it('spans publish to the last clip as instants, evenly, in order', () => {
    const clips = buildTimeline({
      publishedAt: D(30), thumbs: [th(1, 'a', D(30)), th(2, 'b', new Date(Date.UTC(2026, 8, 2, 12)).toISOString())],
      titles: [], now: D(4 + 30),
    });
    const ticks = timelineTicks(clips);
    // epoch ms, not day strings: which day two instants share depends on the reader's zone,
    // so the ruler is formatted (and collapsed) in the browser.
    for (const t of ticks) expect(typeof t).toBe('number');
    expect(ticks[0]).toBe(Date.parse(clips[0].at));
    expect(ticks[ticks.length - 1]).toBe(Date.parse(clips[clips.length - 1].at));
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
  });
  it('is one tick for a same-instant history', () => {
    expect(timelineTicks([{ kind: 'now', key: 'now', at: D(30), url: '', title: '', score: null }]))
      .toEqual([Date.parse(D(30))]);
  });
  it('is empty for no clips', () => {
    expect(timelineTicks([])).toEqual([]);
  });
});

describe('nowLabel', () => {
  it('drops the multiple when there is no score', () => {
    expect(nowLabel(null)).toBe('NOW');
  });
});
