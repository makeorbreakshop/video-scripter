import {
  ageOffset, liftLabel, ratioAround, buildPackaging, chipClusters, clampPopover, stackLabel,
  CHIP_MIN_GAP_PX,
} from './packaging-events';
import type { PackagingGroup } from './packaging-groups';
import type { SeriesPoint } from './chart-series';
import type { TypicalPoint } from '../admin/video-curve';

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-04T09:00:00Z');
const at = (days: number) => new Date(T0 + days * DAY).toISOString();

const swap = (v: number, days: number): PackagingGroup => ({
  kind: 'swap', key: `swap-${v}`, at: at(days), endAt: null, version: v,
  url: `u${v}`, chip: 'swap', variants: [], markerKeys: [`thumb-${v}`],
});
const title = (v: number, days: number, t: string, prev: string | null): PackagingGroup => ({
  kind: 'title', key: `title-${v}`, at: at(days), endAt: null, version: v,
  title: t, previousTitle: prev, chip: 'title', variants: [], markerKeys: [`title-${v}`],
});
const test = (days: number, endDays: number): PackagingGroup => ({
  kind: 'test', key: 'test', at: at(days), endAt: at(endDays), status: 'settled',
  winner: 'B', chip: 'A/B', headline: '2 thumbnails · B won', range: 'Sep 7 – Sep 8',
  variants: [
    { label: 'A', version: 2, url: 'ua', current: false },
    { label: 'B', version: 3, url: 'ub', current: true },
  ],
  markerKeys: ['thumb-2', 'thumb-3'],
});

describe('ageOffset', () => {
  it('reads days and hours past a day', () => {
    expect(ageOffset(0, 29 * 3600_000)).toBe('+1d 5h');
  });
  it('reads hours and minutes under a day', () => {
    expect(ageOffset(0, 5 * 3600_000 + 12 * 60_000)).toBe('+5h 12m');
  });
  it('reads minutes under an hour', () => {
    expect(ageOffset(0, 12 * 60_000)).toBe('+12m');
  });
  it('never goes backwards', () => {
    expect(ageOffset(1000, 0)).toBe('+0m');
  });
});

describe('liftLabel', () => {
  it('writes one decimal under ten', () => {
    expect(liftLabel(1.44, 2.02)).toBe('1.4× → 2.0×');
  });
  it('is null when either end is missing', () => {
    expect(liftLabel(1.4, null)).toBeNull();
    expect(liftLabel(null, 2)).toBeNull();
  });
});

describe('ratioAround', () => {
  const series: SeriesPoint[] = [
    { day: 0, views: 100, kind: 'implied' },
    { day: 1, views: 1400, kind: 'measured' },
    { day: 2, views: 4000, kind: 'measured' },
    { day: 3, views: 9000, kind: 'forecast' },
  ];
  const curve: TypicalPoint[] = [
    { day: 0, expected: 100, kind: 'measured' },
    { day: 1, expected: 1000, kind: 'measured' },
    { day: 2, expected: 2000, kind: 'measured' },
    { day: 3, expected: 3000, kind: 'measured' },
  ] as any;

  it('is the same-age score either side of the event', () => {
    expect(ratioAround(series, curve, 1.5)).toEqual({ before: 1.4, after: 2 });
  });
  it('ignores forecast and implied points — only what we counted', () => {
    expect(ratioAround(series, curve, 2.5).after).toBeNull();
  });
  it('has no before when the event precedes every measurement', () => {
    expect(ratioAround(series, curve, 0.5).before).toBeNull();
  });
  it('is empty when nothing was measured', () => {
    expect(ratioAround([], curve, 1)).toEqual({ before: null, after: null });
  });
});

describe('buildPackaging', () => {
  const base = {
    originAt: at(0), publishedAt: at(0), title: 'New title', publishedUrl: 'u0',
  };

  it('numbers groups from 1 and keeps publish as card 0 with no chip', () => {
    const { events, cards } = buildPackaging({ ...base, groups: [swap(2, 1), swap(3, 2)] });
    expect(events.map((e) => e.index)).toEqual([1, 2]);
    expect(cards.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(cards[0].label).toEqual([{ kind: 'text', text: 'STARTED' }, { kind: 'time', ms: T0 }]);
  });

  it('gives a test ONE index and one card per variant, winner marked once', () => {
    const { events, cards } = buildPackaging({ ...base, groups: [swap(1, 1), test(3, 4)] });
    expect(events).toHaveLength(2);
    const testCards = cards.filter((c) => c.kind === 'test');
    expect(testCards.map((c) => c.index)).toEqual([2, 2]);
    expect(testCards.filter((c) => c.winner)).toHaveLength(1);
    expect(testCards[1].winner).toBe(true);
    expect(testCards[1].label).toContainEqual({ kind: 'text', text: 'WINNER' });
    expect(testCards[0].label).toContainEqual({ kind: 'range', from: Date.parse(at(3)), to: Date.parse(at(4)) });
  });

  it('shares one key between an event and its cards', () => {
    const { events, cards } = buildPackaging({ ...base, groups: [test(3, 4)] });
    expect(cards.filter((c) => c.eventKey === events[0].key)).toHaveLength(2);
  });

  it('labels a thumbnail change with its index, word, age offset and lift', () => {
    const series: SeriesPoint[] = [
      { day: 1, views: 1400, kind: 'measured' },
      { day: 2, views: 4000, kind: 'measured' },
    ];
    const curve = [
      { day: 1, expected: 1000 }, { day: 2, expected: 2000 },
    ] as TypicalPoint[];
    const { cards } = buildPackaging({ ...base, groups: [swap(2, 1 + 5 / 24)], series, curve });
    expect(cards[1].label).toEqual([
      { kind: 'text', text: '1' },
      { kind: 'text', text: 'THUMBNAIL' },
      { kind: 'text', text: '+1d 5h' },
      { kind: 'text', text: '1.4× → 2.0×' },
    ]);
  });

  it('drops the lift when there is nothing measured either side', () => {
    const { cards } = buildPackaging({ ...base, groups: [swap(2, 1)] });
    expect(cards[1].label.map((s: any) => s.text)).toEqual(['1', 'THUMBNAIL', '+1d 0h']);
  });

  it('carries the title diff: the old one struck through, the new one under it', () => {
    const { cards } = buildPackaging({
      ...base, title: 'Second', groups: [title(2, 1, 'Second', 'First')],
    });
    expect(cards[0].title).toBe('First');
    expect(cards[1].previousTitle).toBe('First');
    expect(cards[1].title).toBe('Second');
  });

  it('shows a title change on the image that was live at the time', () => {
    const { events } = buildPackaging({
      ...base, groups: [swap(2, 1), title(2, 2, 'Second', 'First')],
    });
    expect(events[1].url).toBe('u2');
  });

  it('colours the three kinds apart', () => {
    const { events } = buildPackaging({ ...base, groups: [swap(2, 1), title(2, 2, 'b', 'a'), test(3, 4)] });
    expect(events.map((e) => e.kind)).toEqual(['thumbnail', 'title', 'test']);
  });
});

describe('chipClusters', () => {
  const events = buildPackaging({
    originAt: at(0), publishedAt: at(0), title: 't', publishedUrl: 'u0',
    groups: [swap(2, 1), swap(3, 1.02), swap(4, 1.04), swap(5, 8)],
  }).events;

  it('collapses chips closer than the minimum gap into one stack', () => {
    const c = chipClusters(events, [0, 10], 1000);
    expect(c).toHaveLength(2);
    expect(c[0].events).toHaveLength(3);
    expect(c[0].label).toBe('1–3');
    expect(c[1].label).toBe('4');
  });

  it('separates them again once the reader zooms in', () => {
    const c = chipClusters(events, [0.9, 1.1], 1000);
    expect(c).toHaveLength(3);
    expect(c.map((x) => x.label)).toEqual(['1', '2', '3']);
  });

  it('drops what is outside the viewport', () => {
    expect(chipClusters(events, [5, 10], 1000).map((c) => c.label)).toEqual(['4']);
  });

  it('places a chip proportionally across the plot', () => {
    const c = chipClusters(events, [0, 10], 1000);
    expect(c[0].x).toBeCloseTo(100, 5);
  });

  it('needs a real span and a real width', () => {
    expect(chipClusters(events, [1, 1], 1000)).toEqual([]);
    expect(chipClusters(events, [0, 10], 0)).toEqual([]);
  });

  it('honours a custom gap', () => {
    expect(chipClusters(events, [0, 10], 1000, 1)).toHaveLength(4);
    expect(CHIP_MIN_GAP_PX).toBe(56);
  });
});

describe('clampPopover', () => {
  it('centres on the chip when there is room', () => {
    expect(clampPopover(500, 200, 1000)).toBe(424);
  });
  it('never runs off the left edge', () => {
    expect(clampPopover(0, 200, 1000)).toBe(0);
  });
  it('never runs off the right edge', () => {
    expect(clampPopover(1000, 200, 1000)).toBe(800);
  });
  it('gives up rather than going negative on a narrow plot', () => {
    expect(clampPopover(10, 400, 200)).toBe(0);
  });
});

describe('stackLabel', () => {
  const ev = (kind: any, index: number) => ({ key: `k${index}`, index, kind, at: '', day: 0, url: '', markerKeys: [] });
  it('names a single event', () => {
    expect(stackLabel([ev('thumbnail', 1)] as any)).toBe('THUMBNAIL');
  });
  it('counts a stack of one kind', () => {
    expect(stackLabel([ev('thumbnail', 1), ev('thumbnail', 2)] as any)).toBe('2 THUMBNAIL');
  });
  it('calls a mixed stack changes', () => {
    expect(stackLabel([ev('thumbnail', 1), ev('title', 2)] as any)).toBe('2 CHANGES');
  });
});
