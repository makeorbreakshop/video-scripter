// The pure half of /app/angles: what a URL means, and how a board's rows are ordered and grouped.
import {
  parseAngleBucket, parseAngleRange, parseAngleSort, parseDetailSort, parseFamily, parseAnchor,
  parseAngleRows, isAngleId, anglesHref, angleHref, channelBand, capChannelsAcrossBoard, sortAngles, groupByFamily,
  unusedNear, UNUSED_NEAR_FLOOR, ANGLE_PAGE, ANGLE_MAX_ROWS, type AngleStat,
} from './angles-url';

const stat = (over: Partial<AngleStat>): AngleStat => ({
  angle_id: 'a', label: 'A', definition: 'd', kind: 'title',
  family_id: 'f1', family_label: 'F1', family_position: 0,
  n: 10, median: 3, n_near: 1, n_adjacent: 1, n_far: 8, examples: [], ...over,
});

const board = { bucket: 'all', range: '90d', sort: 'median', family: null, anchor: null } as const;

describe('URL parameters', () => {
  it('defaults to all / 90d / median, and rejects anything else', () => {
    expect(parseAngleBucket(undefined)).toBe('all');
    expect(parseAngleBucket('sideways')).toBe('all');
    expect(parseAngleRange(undefined)).toBe('90d');
    expect(parseAngleRange('7d')).toBe('90d'); // Outliers has 7d; this page does not
    expect(parseAngleSort(undefined)).toBe('median');
    expect(parseAngleSort('alphabetical')).toBe('median');
    expect(parseDetailSort(undefined)).toBe('score');
  });

  it('accepts the other choices, from a bare value or the first of a repeated one', () => {
    expect(parseAngleBucket('near')).toBe('near');
    expect(parseAngleBucket(['far', 'near'])).toBe('far');
    expect(parseAngleRange('365d')).toBe('365d');
    expect(parseAngleSort('count')).toBe('count');
    expect(parseDetailSort('published')).toBe('published');
  });

  it('only lets taxonomy-shaped ids reach a query parameter', () => {
    expect(parseFamily('ranking_tiering')).toBe('ranking_tiering');
    expect(parseFamily('tn_person')).toBe('tn_person');
    expect(parseFamily("x'; drop table angles --")).toBeNull();
    expect(parseFamily('Ranking')).toBeNull(); // the enum is lower case
    expect(parseFamily(undefined)).toBeNull();
    expect(isAngleId('top_n_countdown')).toBe(true);
    expect(isAngleId('../../etc/passwd')).toBe(false);
  });

  it('only lets a real channel id be the anchor', () => {
    expect(parseAnchor('UCjWkNxpp3UHdEavpM_19--Q')).toBe('UCjWkNxpp3UHdEavpM_19--Q');
    expect(parseAnchor('nonsense')).toBeNull();
  });

  it('clamps the row count to one page at the low end and the cap at the high', () => {
    expect(parseAngleRows(undefined)).toBe(ANGLE_PAGE);
    expect(parseAngleRows('1')).toBe(ANGLE_PAGE);
    expect(parseAngleRows('99999')).toBe(ANGLE_MAX_ROWS);
    expect(parseAngleRows('120')).toBe(120);
  });
});

describe('hrefs carry only what differs from the defaults', () => {
  it('is the bare path at the defaults', () => {
    expect(anglesHref(board)).toBe('/app/angles');
    expect(angleHref('top_n_countdown', { bucket: 'all', range: '90d', sort: 'score', anchor: null }))
      .toBe('/app/angles/top_n_countdown');
  });

  it('names every parameter that is off the default', () => {
    expect(anglesHref({ ...board, bucket: 'near', range: '30d', sort: 'count', family: 'cost_value' }))
      .toBe('/app/angles?bucket=near&range=30d&sort=count&family=cost_value');
  });

  it('keeps the anchor, which is never a default', () => {
    expect(anglesHref({ ...board, anchor: 'UCjWkNxpp3UHdEavpM_19--Q' }))
      .toBe('/app/angles?anchor=UCjWkNxpp3UHdEavpM_19--Q');
  });

  it('escapes the angle id rather than trusting it into a path', () => {
    expect(angleHref('a/b', { bucket: 'all', range: '90d', sort: 'score', anchor: null }))
      .toBe('/app/angles/a%2Fb');
  });
});

const ch = (id: string, likeness: number | null = 1) => ({ channel_id: id, creator_likeness: likeness });

describe('the channel band', () => {
  it('is empty without an anchor, so the board asks for nothing rather than for everything', () => {
    expect(channelBand(null, { floor: 0.5 })).toEqual([]);
  });

  it('is near, then adjacent, then far — the order IS the example ranking', () => {
    const band = channelBand(
      { near: [ch('UC1')], adjacent: [ch('UC2')], far: [ch('UC3'), ch('UC4')] },
      { floor: null },
    );
    expect(band.map((c) => c.channel_id)).toEqual(['UC1', 'UC2', 'UC3', 'UC4']);
    expect(band.map((c) => c.bucket)).toEqual(['near', 'adjacent', 'far', 'far']);
  });

  it('drops channels below the creator-likeness floor from every bucket, near included', () => {
    const band = channelBand(
      { near: [ch('UC1', 0.4)], adjacent: [ch('UC2', 0.9)], far: [ch('UC3', 0.2)] },
      { floor: 0.6 },
    );
    expect(band.map((c) => c.channel_id)).toEqual(['UC2']);
  });

  it('keeps a channel with no measurement: a missing number must not empty the board', () => {
    expect(channelBand({ near: [ch('UC1', null)], adjacent: [], far: [] }, { floor: 0.9 }))
      .toEqual([{ channel_id: 'UC1', bucket: 'near' }]);
  });

  it('cuts far at the band limit, keeping the closest strangers', () => {
    const far = ['UC3', 'UC4', 'UC5'].map((id) => ch(id));
    expect(channelBand({ near: [], adjacent: [], far }, { floor: null, farLimit: 2 })
      .map((c) => c.channel_id)).toEqual(['UC3', 'UC4']);
  });
});

describe('the board-wide channel cap', () => {
  const ex = (id: string, channel_id: string) => ({
    id, channel_id, title: id, channel_name: channel_id, bucket: 'near' as const,
    score: 3, thumbnail_url: null, variation: null, published_at: '2026-01-01T00:00:00.000Z',
    view_count: 0,
  });

  it('spends a channel three times and then stops, in the order the angles are given', () => {
    const rows = ['a', 'b', 'c', 'd'].map((angle_id) =>
      stat({ angle_id, examples: [ex(`${angle_id}1`, 'UCbig'), ex(`${angle_id}2`, `UC${angle_id}`)] }));
    const out = capChannelsAcrossBoard(rows, 2);
    expect(out.map((r) => r.examples.map((e) => e.channel_id)))
      .toEqual([['UCbig', 'UCa'], ['UCbig', 'UCb'], ['UCbig', 'UCc'], ['UCd']]);
  });

  it('never shows more than the tile count even with headroom fetched', () => {
    const rows = [stat({ angle_id: 'a', examples: ['UC1', 'UC2', 'UC3'].map((c) => ex(c, c)) })];
    expect(capChannelsAcrossBoard(rows, 2)[0].examples).toHaveLength(2);
  });
});

describe('ordering a family', () => {
  const a = stat({ angle_id: 'a', n: 5, median: 9 });
  const b = stat({ angle_id: 'b', n: 40, median: 3 });

  it('leads with the best median by default', () => {
    expect(sortAngles([b, a], 'median').map((x) => x.angle_id)).toEqual(['a', 'b']);
  });

  it('leads with the biggest count when asked', () => {
    expect(sortAngles([a, b], 'count').map((x) => x.angle_id)).toEqual(['b', 'a']);
  });

  it('does not mutate what it was given', () => {
    const rows = [b, a];
    sortAngles(rows, 'median');
    expect(rows.map((x) => x.angle_id)).toEqual(['b', 'a']);
  });
});

describe('grouping into families', () => {
  it('keeps the taxonomy order, not the order the rows arrived in', () => {
    const rows = [
      stat({ angle_id: 'x', family_id: 'f3', family_label: 'F3', family_position: 3 }),
      stat({ angle_id: 'y', family_id: 'f1', family_label: 'F1', family_position: 1 }),
      stat({ angle_id: 'z', family_id: 'f3', family_label: 'F3', family_position: 3 }),
    ];
    const out = groupByFamily(rows);
    expect(out.map((s) => s.family_id)).toEqual(['f1', 'f3']);
    expect(out[1].angles.map((a) => a.angle_id)).toEqual(['x', 'z']);
  });
});

describe('unused near you', () => {
  it('is the angles with nothing near and enough evidence elsewhere, best median first', () => {
    const rows = [
      stat({ angle_id: 'thin', n_near: 0, n_adjacent: 1, n_far: 1, median: 20 }),   // too little evidence
      stat({ angle_id: 'used', n_near: 2, n_adjacent: 9, n_far: 9, median: 15 }),   // already tried here
      stat({ angle_id: 'good', n_near: 0, n_adjacent: 2, n_far: 9, median: 4 }),
      stat({ angle_id: 'best', n_near: 0, n_adjacent: 0, n_far: 8, median: 7 }),
    ];
    expect(unusedNear(rows).map((r) => r.angle_id)).toEqual(['best', 'good']);
  });

  it('takes the floor from adjacent and far together, not from either alone', () => {
    const split = stat({ angle_id: 's', n_near: 0, n_adjacent: 3, n_far: 5, median: 1 });
    expect(split.n_adjacent + split.n_far).toBe(UNUSED_NEAR_FLOOR);
    expect(unusedNear([split])).toHaveLength(1);
  });
});
