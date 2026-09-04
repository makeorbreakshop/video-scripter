import {
  recencyLabel, sparkDirection,
  GROUP_COLORS, nextGroupColor, groupColorVar, isGroupColor, normalizeGroupName,
  filterByGroup, groupCounts, triState, triStateAction,
  downsample, percentChange, percentLabel, sparkPath, SPARK_MAX_POINTS,
  notifyGate, canNotifyMore,
  importDefaults, importVisible, importButtonLabel,
} from './groups-view';

describe('group colours', () => {
  it('assigns the palette round-robin by how many groups exist', () => {
    expect(nextGroupColor(0)).toBe('green');
    expect(nextGroupColor(1)).toBe('amber');
    expect(nextGroupColor(7)).toBe('slate');
    // Ninth group starts the palette again rather than running out.
    expect(nextGroupColor(8)).toBe('green');
    expect(nextGroupColor(19)).toBe(GROUP_COLORS[19 % 8]);
  });

  it('survives nonsense counts', () => {
    expect(nextGroupColor(-3)).toBe('green');
    expect(nextGroupColor(NaN as any)).toBe('green');
  });

  it('resolves to a theme variable, never a hex', () => {
    expect(groupColorVar('teal')).toBe('var(--cs-g-teal)');
    // An unknown key must not blank the dot out.
    expect(groupColorVar('chartreuse')).toBe('var(--cs-g-slate)');
    expect(groupColorVar(null)).toBe('var(--cs-g-slate)');
    expect(isGroupColor('violet')).toBe(true);
    expect(isGroupColor('violet ')).toBe(false);
  });

  it('normalises the name a person typed', () => {
    expect(normalizeGroupName('  Laser   cutters ')).toBe('Laser cutters');
    expect(normalizeGroupName('   ')).toBeNull();
    expect(normalizeGroupName(null)).toBeNull();
    expect(normalizeGroupName('x'.repeat(80))).toHaveLength(40);
  });
});

describe('chip filtering', () => {
  const rows = [
    { channel_id: 'a', groups: ['g1'] },
    { channel_id: 'b', groups: ['g1', 'g2'] },
    { channel_id: 'c', groups: [] },
    { channel_id: 'd', groups: null },
  ];

  it('All shows everything', () => {
    expect(filterByGroup(rows, null)).toHaveLength(4);
    expect(filterByGroup(rows, 'all')).toHaveLength(4);
  });

  it('a group shows only its members', () => {
    expect(filterByGroup(rows, 'g1').map((r) => r.channel_id)).toEqual(['a', 'b']);
    expect(filterByGroup(rows, 'g2').map((r) => r.channel_id)).toEqual(['b']);
    expect(filterByGroup(rows, 'nope')).toEqual([]);
  });

  it('counts every chip, including All', () => {
    const groups = [
      { id: 'g1', name: 'Laser', color: 'green', position: 0 },
      { id: 'g2', name: 'Makers', color: 'amber', position: 1 },
      { id: 'g3', name: 'Empty', color: 'teal', position: 2 },
    ];
    expect(groupCounts(rows, groups)).toEqual({ all: 4, g1: 2, g2: 1, g3: 0 });
  });
});

describe('tri-state', () => {
  const a = { channel_id: 'a', groups: ['g1'] };
  const b = { channel_id: 'b', groups: ['g1', 'g2'] };
  const c = { channel_id: 'c', groups: [] };

  it('is on only when every selected row is in the group', () => {
    expect(triState([a, b], 'g1')).toBe('on');
    expect(triState([a, c], 'g1')).toBe('mixed');
    expect(triState([c], 'g1')).toBe('off');
    expect(triState([a, b], 'g2')).toBe('mixed');
  });

  it('treats an empty selection as off, not mixed', () => {
    expect(triState([], 'g1')).toBe('off');
  });

  it('only a full group removes; everything else adds', () => {
    expect(triStateAction('on')).toBe('remove');
    expect(triStateAction('mixed')).toBe('add');
    expect(triStateAction('off')).toBe('add');
  });
});

describe('sparkline', () => {
  const series = (n: number) => Array.from({ length: n }, (_, i) => ({ t: i, v: 100 + i }));

  it('leaves a short series alone', () => {
    expect(downsample(series(10))).toHaveLength(10);
    expect(downsample([])).toEqual([]);
  });

  it('thins a long one to the cap and keeps both ends', () => {
    const out = downsample(series(200));
    expect(out).toHaveLength(SPARK_MAX_POINTS);
    expect(out[0]).toEqual({ t: 0, v: 100 });
    expect(out[out.length - 1]).toEqual({ t: 199, v: 299 });
  });

  it('reads the percent change off the first and last point', () => {
    expect(percentChange([{ t: 0, v: 100 }, { t: 1, v: 138 }])).toBe(38);
    expect(percentChange([{ t: 0, v: 100 }, { t: 1, v: 88 }])).toBe(-12);
    expect(percentChange([{ t: 0, v: 100 }])).toBeNull();
    expect(percentChange([])).toBeNull();
    // A zero start would be an infinite rise, which says nothing.
    expect(percentChange([{ t: 0, v: 0 }, { t: 1, v: 50 }])).toBeNull();
  });

  it('labels the change with its sign', () => {
    expect(percentLabel(38)).toBe('+38%');
    expect(percentLabel(-12)).toBe('-12%');
    expect(percentLabel(0)).toBe('0%');
    expect(percentLabel(null)).toBe('');
  });

  it('draws a polyline inside the box, flat series included', () => {
    const path = sparkPath([{ t: 0, v: 10 }, { t: 1, v: 20 }], 120, 28);
    const pts = path.split(' ').map((p) => p.split(',').map(Number));
    expect(pts[0][0]).toBe(0);
    expect(pts[1][0]).toBe(120);
    // Rising series: the last point sits higher on the screen (smaller y).
    expect(pts[1][1]).toBeLessThan(pts[0][1]);
    for (const [, y] of pts) { expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(28); }
    expect(sparkPath([{ t: 0, v: 5 }, { t: 1, v: 5 }], 120, 28)).toBe('0,14 120,14');
    expect(sparkPath([])).toBe('');
  });
});

describe('notify limit', () => {
  it('reads the plan number as the notify limit', () => {
    const g = notifyGate(8, 25);
    expect(g.label).toBe('NOTIFYING 8/25');
    expect(g.segments).toBe(25);
    expect(g.atLimit).toBe(false);
    expect(notifyGate(25, 25).atLimit).toBe(true);
  });

  it('an unlimited plan reports the count, not a ratio', () => {
    const g = notifyGate(3, Number.POSITIVE_INFINITY);
    expect(g.unlimited).toBe(true);
    expect(g.label).toBe('NOTIFYING 3');
    expect(g.atLimit).toBe(false);
  });

  it('draws no meter when there is no cap to measure against', () => {
    // An unlimited plan at zero drew one empty 9x10 segment, which reads as a broken widget
    // rather than as a statistic. A bar that can only ever be empty is not measuring anything.
    expect(notifyGate(0, Number.POSITIVE_INFINITY).bar).toBe(false);
    expect(notifyGate(3, Number.POSITIVE_INFINITY).bar).toBe(false);
    expect(notifyGate(0, 25).bar).toBe(true);
  });

  it('caps the meter so an enormous limit does not draw a thousand segments', () => {
    expect(notifyGate(2, 1000).segments).toBe(40);
  });

  it('refuses a batch that would not fit, rather than half-applying it', () => {
    expect(canNotifyMore(8, 25, 10).ok).toBe(true);
    expect(canNotifyMore(20, 25, 5).ok).toBe(true);
    const no = canNotifyMore(20, 25, 6);
    expect(no.ok).toBe(false);
    expect(no.reason).toMatch(/room for 5 more/);
    expect(canNotifyMore(25, 25, 1).reason).toMatch(/Mute one first/);
    expect(canNotifyMore(999, Number.POSITIVE_INFINITY, 500).ok).toBe(true);
  });
});

describe('import sheet', () => {
  const subs = [
    { channel_id: 'a', name: 'A', tracked: false },
    { channel_id: 'b', name: 'B', tracked: true },
    { channel_id: 'c', name: 'C', tracked: false },
  ];

  it('checks everything except what is already tracked', () => {
    expect(Array.from(importDefaults(subs)).sort()).toEqual(['a', 'c']);
    expect(importDefaults([]).size).toBe(0);
  });

  it('shows five and collapses the rest', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ channel_id: `c${i}`, name: `C${i}`, tracked: false }));
    expect(importVisible(many, false)).toMatchObject({ more: 7 });
    expect(importVisible(many, false).shown).toHaveLength(5);
    expect(importVisible(many, true).shown).toHaveLength(12);
    expect(importVisible(subs, false)).toMatchObject({ more: 0 });
  });

  it('counts the button', () => {
    expect(importButtonLabel(1)).toBe('Track 1 channel');
    expect(importButtonLabel(162)).toBe('Track 162 channels');
  });
});

describe('recencyLabel', () => {
  const now = Date.parse('2026-09-04T12:00:00Z');
  it('says how long ago, not how many videos', () => {
    expect(recencyLabel('2026-09-04T02:00:00Z', now)).toBe('today');
    expect(recencyLabel('2026-09-03T02:00:00Z', now)).toBe('1d ago');
    expect(recencyLabel('2026-08-29T12:00:00Z', now)).toBe('6d ago');
    expect(recencyLabel('2026-08-14T12:00:00Z', now)).toBe('3w ago');
    expect(recencyLabel('2026-03-04T12:00:00Z', now)).toBe('6mo ago');
    expect(recencyLabel('2023-09-04T12:00:00Z', now)).toBe('3y ago');
  });
  it('is a dash when nothing is known, never a guess', () => {
    expect(recencyLabel(null, now)).toBe('—');
    expect(recencyLabel('not a date', now)).toBe('—');
  });
});

describe('sparkDirection', () => {
  it('separates falling from flat, which colour alone did not', () => {
    expect(sparkDirection(38)).toBe('up');
    expect(sparkDirection(-12)).toBe('down');
    expect(sparkDirection(0)).toBe('flat');
    expect(sparkDirection(0.2)).toBe('flat');
    expect(sparkDirection(null)).toBe('flat');
  });
});
