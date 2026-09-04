// The test is the unit — on the chart as well as in the strip.
//
// Po_Dh7WLgmM ("The Most Overhyped and Underhyped New AI Models", Matt Wolfe) wore two images
// alternating over about two hours on 2026-09-03 ET. thumbnail_versions is a *state* log, so
// that rotation is EIGHT rows; the chart used to draw it as "6 swaps", which is a count of
// database writes, not of decisions. One A/B test, two variants, one shaded window.
import { groupPackaging, packagingMarks, testChip } from './packaging-groups';
import { buildTimeline } from './packaging-timeline';

const A = { sha256: 'd29178724c', phash: '062c84ccccce9e93' };
const B = { sha256: 'd0ba7b5937', phash: 'e196b6a6f1aebe9d' };

/** The real rows, times as stored (UTC). 19:10 ET is 23:10 UTC. */
const WOLFE = [
  { version: 1, ...A, first_seen: '2026-09-03T07:18:58.265Z' },
  { version: 2, ...B, first_seen: '2026-09-03T23:10:40.027Z' },
  { version: 3, ...A, first_seen: '2026-09-04T00:06:10.394Z' },
  { version: 4, ...B, first_seen: '2026-09-04T00:11:05.355Z' },
  { version: 5, ...A, first_seen: '2026-09-04T00:20:48.240Z' },
  { version: 6, ...B, first_seen: '2026-09-04T00:25:48.481Z' },
  { version: 7, ...A, first_seen: '2026-09-04T00:30:54.103Z' },
  { version: 8, ...B, first_seen: '2026-09-04T00:50:49.165Z' },
].map((t) => ({ ...t, url: `/thumb/${t.version}` }));

const PUBLISHED = '2026-09-03T02:14:55.000Z';
/** Well past SETTLE_HOURS, so the rotation reads as finished. */
const LATER = '2026-09-08T00:00:00.000Z';

describe('groupPackaging: the Matt Wolfe rotation is ONE test', () => {
  const groups = groupPackaging({ publishedAt: PUBLISHED, thumbs: WOLFE, titles: [], now: LATER });

  it('yields exactly one group', () => {
    expect(groups).toHaveLength(1);
  });

  it('calls it a test with two variants, not six swaps', () => {
    const g = groups[0];
    expect(g.kind).toBe('test');
    if (g.kind !== 'test') throw new Error('unreachable');
    expect(g.variants.map((v) => v.label)).toEqual(['A', 'B']);
    expect(g.chip).toBe('A/B');
    // The words a reader sees never contain a rotation count.
    expect(JSON.stringify(g)).not.toMatch(/swap/i);
    expect(g.chip).not.toMatch(/\d\s*(swaps|rotations)/);
  });

  it('spans first rotation to the settle, so the chart can shade a window', () => {
    const g = groups[0];
    if (g.kind !== 'test') throw new Error('unreachable');
    expect(g.at).toBe('2026-09-03T23:10:40.027Z');           // the first flip, not publish
    expect(new Date(g.endAt).getTime()).toBeGreaterThan(new Date(g.at).getTime());
  });

  it('carries every version marker it covers, so hover lights all of them', () => {
    const g = groups[0];
    expect(g.markerKeys).toEqual(['thumb-2', 'thumb-3', 'thumb-4', 'thumb-5', 'thumb-6', 'thumb-7', 'thumb-8']);
  });

  it('never puts a statistic in the words a reader sees', () => {
    const g = groups[0];
    if (g.kind !== 'test') throw new Error('unreachable');
    // The watcher registered a rotation; it did not run an experiment. No percentages, no
    // significance, no rotation counts — see lib/app/test-row.ts for the rule.
    for (const words of [g.chip, g.headline, g.range]) {
      expect(words).not.toMatch(/\d+\s*%|significan|confidence|p-value|rotation/i);
    }
  });
});

describe('groupPackaging: one change is one swap, one title is one title', () => {
  const oneSwap = [
    { version: 1, ...A, first_seen: '2026-09-01T00:00:00.000Z', url: '/a' },
    { version: 2, ...B, first_seen: '2026-09-02T00:00:00.000Z', url: '/b' },
  ];

  it('a v2 that never flipped back is a single swap', () => {
    const groups = groupPackaging({ publishedAt: '2026-09-01T00:00:00.000Z', thumbs: oneSwap, titles: [], now: LATER });
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('swap');
    expect(groups[0].chip).toBe('swap');
    expect(groups[0].markerKeys).toEqual(['thumb-2']);
  });

  it('a title v2 is one title marker', () => {
    const groups = groupPackaging({
      publishedAt: '2026-09-01T00:00:00.000Z',
      thumbs: [oneSwap[0]],
      titles: [
        { version: 1, title: 'first', first_seen: '2026-09-01T00:00:00.000Z' },
        { version: 2, title: 'second', first_seen: '2026-09-02T06:00:00.000Z' },
      ],
      now: LATER,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe('title');
    expect(groups[0].chip).toBe('title');
    expect(groups[0].markerKeys).toEqual(['title-2']);
  });

  it('an untouched video has nothing to mark', () => {
    expect(groupPackaging({ publishedAt: PUBLISHED, thumbs: [oneSwap[0]], titles: [], now: LATER })).toEqual([]);
    expect(groupPackaging({ publishedAt: PUBLISHED, thumbs: [], titles: [], now: LATER })).toEqual([]);
  });
});

describe('the strip and the chart read the same groups', () => {
  const input = { publishedAt: PUBLISHED, thumbs: WOLFE, titles: [], now: LATER };

  it('the timeline’s TEST clip is the group, key for key', () => {
    const groups = groupPackaging(input);
    const clip = buildTimeline({ ...input, titles: [] }).find((c) => c.kind === 'test');
    expect(clip).toBeTruthy();
    expect(clip!.key).toBe(groups[0].key);
    expect((clip as any).markerKeys).toEqual(groups[0].markerKeys);
    expect((clip as any).at).toBe(groups[0].at);
  });

  it('the chart’s marks are the same groups placed on the day axis', () => {
    const groups = groupPackaging(input);
    const marks = packagingMarks(groups, PUBLISHED);
    expect(marks.map((m) => m.key)).toEqual(groups.map((g) => g.key));
    const m = marks[0];
    expect(m.kind).toBe('test');
    // 2026-09-03 23:10Z is ~0.87 days after a 2026-09-03 02:14Z publish.
    expect(m.startDay).toBeCloseTo(0.872, 2);
    expect(m.endDay!).toBeGreaterThan(m.startDay);
    expect(m.chip).toBe('A/B');
    expect(m.variants.map((v) => v.url)).toEqual(['/thumb/1', '/thumb/2']);
  });

  it('places a swap and a title as rules with no width', () => {
    const groups = groupPackaging({
      publishedAt: '2026-09-01T00:00:00.000Z',
      thumbs: [
        { version: 1, ...A, first_seen: '2026-09-01T00:00:00.000Z', url: '/a' },
        { version: 2, ...B, first_seen: '2026-09-02T00:00:00.000Z', url: '/b' },
      ],
      titles: [],
      now: LATER,
    });
    const marks = packagingMarks(groups, '2026-09-01T00:00:00.000Z');
    expect(marks[0].startDay).toBeCloseTo(1, 6);
    expect(marks[0].endDay).toBeNull();
  });
});

describe('testChip', () => {
  it('names the variants, not their number', () => {
    expect(testChip(['A', 'B'])).toBe('A/B');
    expect(testChip(['A', 'B', 'C'])).toBe('A/B/C');
    expect(testChip(['A'])).toBe('A');
  });
});
