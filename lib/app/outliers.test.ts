// The pure half of /app/outliers: what a URL means, and which channel ids a bucket reads.
import {
  parseBucket, parseOutlierSort, parseOutlierRange, parseAnchor, parseRows,
  parseMin, parseConfidence, parseFloor, outliersHref, floorLabel,
  bucketIds, OUTLIER_PAGE, OUTLIER_MAX_ROWS, DEFAULT_MIN, DEFAULT_CONF, DEFAULT_FLOOR,
} from './outliers-url';
import { SORTS } from './outliers';

const ch = (id: string) => ({ channel_id: id, channel_name: id, score: 0.9, medoid_title: null, creator_likeness: null });
const relations = {
  near: [ch('UCnear1'), ch('UCnear2')],
  adjacent: [ch('UCadj1')],
};

describe('URL parameters', () => {
  it('defaults to near / score / 30d, and rejects anything else', () => {
    expect(parseBucket(undefined)).toBe('near');
    expect(parseBucket('nonsense')).toBe('near');
    expect(parseOutlierSort(undefined)).toBe('score');
    expect(parseOutlierSort('newest')).toBe('score');
    expect(parseOutlierRange(undefined)).toBe('30d');
    expect(parseOutlierRange('all')).toBe('30d');
  });

  it('accepts the other choices, from a bare value or the first of a repeated one', () => {
    expect(parseBucket('adjacent')).toBe('adjacent');
    expect(parseBucket(['far', 'near'])).toBe('far');
    expect(parseOutlierSort('published')).toBe('published');
    expect(parseOutlierSort('views')).toBe('views');
    expect(parseOutlierSort(['views', 'score'])).toBe('views');
    expect(parseOutlierRange('7d')).toBe('7d');
    expect(parseOutlierRange(['90d'])).toBe('90d');
  });

  it('takes an anchor only when it is shaped like a channel id', () => {
    expect(parseAnchor('UCjWkNxpp3UHdEavpM_19--Q')).toBe('UCjWkNxpp3UHdEavpM_19--Q');
    expect(parseAnchor(' UCjWkNxpp3UHdEavpM_19--Q ')).toBe('UCjWkNxpp3UHdEavpM_19--Q');
    expect(parseAnchor('Make or Break Shop')).toBeNull();
    expect(parseAnchor("UC'; drop table videos; --")).toBeNull();
    expect(parseAnchor(undefined)).toBeNull();
  });

  it('clamps the row count to one page at the bottom and the cap at the top', () => {
    expect(parseRows(undefined)).toBe(OUTLIER_PAGE);
    expect(parseRows('0')).toBe(OUTLIER_PAGE);
    expect(parseRows('120')).toBe(120);
    expect(parseRows('9999')).toBe(OUTLIER_MAX_ROWS);
    expect(parseRows('banana')).toBe(OUTLIER_PAGE);
  });
});

describe('the three rankings', () => {
  it('each parse round-trips through the href builder', () => {
    const base = { bucket: 'near' as const, range: '30d' as const, anchor: null };
    expect(outliersHref({ ...base, sort: 'score' })).toBe('/app/outliers');
    expect(outliersHref({ ...base, sort: 'views' })).toBe('/app/outliers?sort=views');
    expect(outliersHref({ ...base, sort: 'published' })).toBe('/app/outliers?sort=published');
    for (const sort of ['score', 'views', 'published'] as const) {
      const href = outliersHref({ ...base, sort });
      const p = new URLSearchParams(href.split('?')[1] ?? '');
      expect(parseOutlierSort(p.get('sort'))).toBe(sort);
    }
  });

  it('maps each one to an ORDER BY that ends NULLS LAST and names no parameter', () => {
    expect(Object.keys(SORTS).sort()).toEqual(['published', 'score', 'views']);
    expect(SORTS.score).toBe('s.score desc nulls last, v.published_at desc nulls last');
    expect(SORTS.views).toBe('v.view_count desc nulls last, v.published_at desc nulls last');
    expect(SORTS.published).toBe('v.published_at desc nulls last');
    for (const sql of Object.values(SORTS)) {
      for (const key of sql.split(',')) expect(key.trim()).toMatch(/ desc nulls last$/);
      expect(sql).not.toMatch(/\$\d/);
    }
  });
});

describe('bucket → channel ids', () => {
  it('reads near and adjacent as their own lists', () => {
    expect(bucketIds(relations, 'near')).toEqual({ ids: ['UCnear1', 'UCnear2'], mode: 'include' });
    expect(bucketIds(relations, 'adjacent')).toEqual({ ids: ['UCadj1'], mode: 'include' });
  });

  it('reads far as the complement of both, so unranked channels count as far', () => {
    expect(bucketIds(relations, 'far')).toEqual({
      ids: ['UCnear1', 'UCnear2', 'UCadj1'],
      mode: 'exclude',
    });
  });

  it('returns an empty include list when a neighbourhood is empty — never an unbounded read', () => {
    expect(bucketIds({ near: [], adjacent: [] }, 'near')).toEqual({ ids: [], mode: 'include' });
    expect(bucketIds({ near: [], adjacent: [] }, 'far')).toEqual({ ids: [], mode: 'exclude' });
  });
});

describe('quality guards', () => {
  it('defaults to 2x, confirmed + likely, and the 500-view noise floor — not the pool\'s 5,000', () => {
    expect(parseMin(undefined)).toBe(2);
    expect(parseConfidence(undefined)).toEqual(['confirmed', 'likely']);
    expect(parseFloor(undefined)).toBe(500);
    expect(DEFAULT_MIN).toBe(2);
    expect(DEFAULT_CONF).toEqual(['confirmed', 'likely']);
    expect(DEFAULT_FLOOR).toBe(500);
  });

  it('takes only the four multiples, and falls back for anything else', () => {
    expect(parseMin('3')).toBe(3);
    expect(parseMin(['10'])).toBe(10);
    expect(parseMin('4')).toBe(2);
    expect(parseMin('1e9')).toBe(2);
    expect(parseMin('2 or 1=1')).toBe(2);
  });

  it('whitelists confidence names, keeps them in one canonical order, and never returns empty', () => {
    expect(parseConfidence('early')).toEqual(['early']);
    expect(parseConfidence('early,confirmed')).toEqual(['confirmed', 'early']);
    expect(parseConfidence('LIKELY, early')).toEqual(['likely', 'early']);
    expect(parseConfidence('')).toEqual(['confirmed', 'likely']);
    expect(parseConfidence('nonsense')).toEqual(['confirmed', 'likely']);
    expect(parseConfidence("likely'); drop table videos; --")).toEqual(['confirmed', 'likely']);
  });

  it('takes only the five baseline floors, with "any" spelling zero', () => {
    expect(parseFloor('any')).toBe(0);
    expect(parseFloor('1000')).toBe(1000);
    expect(parseFloor('25000')).toBe(25000);
    expect(parseFloor('1234')).toBe(500);
    expect(parseFloor('-1')).toBe(500);
    expect(floorLabel(0)).toBe('Any');
    expect(floorLabel(500)).toBe('500');
    expect(floorLabel(25000)).toBe('25K');
  });
});

describe('the URL carries only what differs from the defaults', () => {
  const base = { bucket: 'near' as const, sort: 'score' as const, range: '30d' as const, anchor: null };

  it('writes nothing for the default guards', () => {
    expect(outliersHref({ ...base, min: 2, conf: ['confirmed', 'likely'], floor: 500 }))
      .toBe('/app/outliers');
  });

  it('writes each guard that moved, and round-trips through the parsers', () => {
    const href = outliersHref({ ...base, min: 5, conf: ['confirmed', 'early'], floor: 0 });
    expect(href).toBe('/app/outliers?min=5&conf=confirmed%2Cearly&floor=any');
    const p = new URLSearchParams(href.split('?')[1]);
    expect(parseMin(p.get('min'))).toBe(5);
    expect(parseConfidence(p.get('conf'))).toEqual(['confirmed', 'early']);
    expect(parseFloor(p.get('floor'))).toBe(0);
  });
});
