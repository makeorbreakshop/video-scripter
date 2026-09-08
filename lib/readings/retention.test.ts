// The specification for what Postgres is allowed to forget.
//
// These are the only tests that can fail *before* data is lost rather than after, so they are
// written as rules ("the survivor of an hour is its last reading", "a day that is not verified
// in R2 cannot be thinned") rather than as snapshots of the current implementation.
import {
  READING_RETENTION, survivingReadings, doomedReadings, tierOf, utcDay, utcHour,
  inLaunchWindow, inLaunchDense,
  readingsKey, readingsIndexKey, historyKey, assertDay, buildRowIndex, sortForArchive,
  checksum, checksumLines, checksumStream, keysetBatches, cursorAfter, keyOf,
  isThinnable, thinnableDays, assertThinnable, dayRange, newestArchivableDay,
  type Reading, type ArchivedDay,
} from './retention';
import { videosPerBatch, thinBatchSql, tableFor, nextVideosSql, selectDaySql, selectDayForVideosSql } from './sql';

const NOW = Date.parse('2026-09-08T12:00:00.000Z');
const ago = (days: number, extra = 0) => new Date(NOW - days * 86_400_000 + extra).toISOString();
const r = (video_id: string, at: string, views: number): Reading => ({ video_id, at, views });

describe('tiers', () => {
  test('the dense window is 4 days and the hourly window ends at 14 (2026-09-08: 7/30 fills the disk)', () => {
    expect(READING_RETENTION.denseWindowDays).toBe(4);
    expect(READING_RETENTION.hourlyWindowDays).toBe(14);
  });

  test('a reading falls in the tier its age puts it in', () => {
    expect(tierOf(ago(0), NOW)).toBe('dense');
    expect(tierOf(ago(3.99), NOW)).toBe('dense');
    expect(tierOf(ago(4.01), NOW)).toBe('hourly');
    expect(tierOf(ago(13.99), NOW)).toBe('hourly');
    expect(tierOf(ago(14.01), NOW)).toBe('daily');
    expect(tierOf(ago(400), NOW)).toBe('daily');
  });

  test('the boundaries are exactly 4 and 14 days, not 3.5 or 15', () => {
    expect(tierOf(NOW - 4 * 86_400_000 + 1, NOW)).toBe('dense');
    expect(tierOf(NOW - 4 * 86_400_000, NOW)).toBe('hourly');
    expect(tierOf(NOW - 14 * 86_400_000, NOW)).toBe('daily');
  });
});

describe('survivingReadings', () => {
  test('nothing inside the dense window is ever deleted', () => {
    const rows = [r('v1', ago(0), 1), r('v1', ago(1), 2), r('v1', ago(6.9), 3)];
    expect(survivingReadings(rows, NOW)).toEqual(rows);
    expect(doomedReadings(rows, NOW)).toEqual([]);
  });

  test('in the hourly tier the LAST reading of each hour survives', () => {
    const base = Date.parse('2026-08-30T05:00:00.000Z'); // 9 days old, not the day's first hour
    const rows = [
      r('v1', '2026-08-30T00:05:00.000Z', 1),               // first of the day, always kept
      r('v1', new Date(base + 0).toISOString(), 10),
      r('v1', new Date(base + 15 * 60_000).toISOString(), 11),
      r('v1', new Date(base + 45 * 60_000).toISOString(), 12),
      r('v1', new Date(base + 60 * 60_000).toISOString(), 20), // next hour
    ];
    const kept = survivingReadings(rows, NOW);
    expect(kept.map((k) => k.views)).toEqual([1, 12, 20]);
  });

  test("the video's FIRST reading of a day always survives — growthExponent reads it", () => {
    const day = '2026-06-01';
    const rows = [
      r('v1', `${day}T00:02:00.000Z`, 100),   // first of the day
      r('v1', `${day}T00:40:00.000Z`, 110),
      r('v1', `${day}T23:50:00.000Z`, 300),   // last of the day
    ];
    const kept = survivingReadings(rows, NOW).map((k) => k.views);
    expect(kept).toContain(100);
    expect(kept).toContain(300);
    expect(kept).not.toContain(110);
  });

  test('thinning cannot move the earliest or latest reading of any video', () => {
    const rows: Reading[] = [];
    for (let i = 0; i < 300; i++) rows.push(r('v1', ago(9, i * 5 * 60_000), 1000 + i));
    const kept = survivingReadings(rows, NOW);
    const byTime = (a: Reading, b: Reading) => Date.parse(String(a.at)) - Date.parse(String(b.at));
    const all = [...rows].sort(byTime), left = [...kept].sort(byTime);
    expect(left[0].at).toBe(all[0].at);
    expect(left[left.length - 1].at).toBe(all[all.length - 1].at);
  });

  test('hours are per video, not global', () => {
    const t = '2026-08-30T05:10:00.000Z';
    const rows = [r('v1', t, 1), r('v2', t, 2)];
    expect(survivingReadings(rows, NOW)).toHaveLength(2);
  });

  test('past 30 days it is the first and last reading per video per UTC day', () => {
    const day = '2026-06-01';
    const rows = [
      r('v1', `${day}T01:00:00.000Z`, 1),
      r('v1', `${day}T13:00:00.000Z`, 2),
      r('v1', `${day}T23:59:00.000Z`, 3),
      r('v1', '2026-06-02T00:01:00.000Z', 4),
    ];
    expect(survivingReadings(rows, NOW).map((k) => k.views)).toEqual([1, 3, 4]);
  });

  test('a reading with an unparseable clock is never deleted', () => {
    const rows = [r('v1', 'not a date', 1), r('v1', '2026-06-01T01:00:00.000Z', 2),
                  r('v1', '2026-06-01T02:00:00.000Z', 3)];
    const kept = survivingReadings(rows, NOW);
    expect(kept.map((k) => k.views)).toContain(1);
  });

  test('survivors and doomed are exact complements, and thinning is idempotent', () => {
    const rows: Reading[] = [];
    for (let i = 0; i < 200; i++) rows.push(r(`v${i % 5}`, ago(9, i * 7 * 60_000), i));
    const kept = survivingReadings(rows, NOW);
    const gone = doomedReadings(rows, NOW);
    expect(kept.length + gone.length).toBe(rows.length);
    expect(new Set([...kept, ...gone]).size).toBe(rows.length);
    expect(survivingReadings(kept, NOW)).toEqual(kept);
  });

  test('the tie-break on identical clocks is deterministic', () => {
    // Two rows share the last instant of the day; the earlier row is the day's first and is kept
    // by the growthExponent rule, so the tie is decided only between the two colliding ones.
    const at = '2026-06-01T23:00:00.000Z';
    const rows = [
      { ...r('v1', '2026-06-01T00:00:00.000Z', 5), id: 'first' },
      { ...r('v1', at, 1), id: 'a' },
      { ...r('v1', at, 2), id: 'b' },
    ];
    const ids = (rs: typeof rows) => survivingReadings(rs, NOW).map((k) => k.id);
    expect(ids(rows)).toEqual(['first', 'b']);
    expect(ids([...rows].reverse())).toEqual(['b', 'first']);
  });
});

// The launch window: the rules that keep the steepest, most-read part of every curve intact.
// Added after scripts/verify-archive.ts measured a 213 % deviation two hours after publish with
// the plain age tiers, and 3 score-affecting changes in 200 videos. See READING_RETENTION.
describe('the launch window', () => {
  const published = '2026-06-01T00:00:00.000Z';
  const p = (mins: number, views = 1000 + mins): Reading => ({
    video_id: 'v1', published_at: published, views,
    at: new Date(Date.parse(published) + mins * 60_000).toISOString(),
  });

  test('the first hours are not thinned at all, however old the readings are', () => {
    const rows = [p(0), p(15), p(30), p(45), p(60)];   // all inside launchDenseHours
    expect(survivingReadings(rows, NOW)).toEqual(rows);
  });

  test('past the dense hours it is hourly, not daily, inside the launch window', () => {
    const h = 60;
    const rows = [p(8 * h), p(8 * h + 15), p(8 * h + 30), p(9 * h)];
    // first of the day, last of hour 8, last of hour 9 — the 15-minute row in between goes
    expect(survivingReadings(rows, NOW).map((x) => x.views))
      .toEqual([p(8 * h).views, p(8 * h + 30).views, p(9 * h).views]);
  });

  test('past the launch window a 30-day-old reading is daily again', () => {
    const d = 1440;
    const rows = [p(5 * d), p(5 * d + 60), p(5 * d + 120)];
    expect(survivingReadings(rows, NOW).map((x) => x.views)).toEqual([p(5 * d).views, p(5 * d + 120).views]);
  });

  test('a row with no published_at gets no launch protection — the policy cannot invent one', () => {
    const rows = [{ video_id: 'v1', at: '2026-06-01T05:00:00Z', views: 1 },
                  { video_id: 'v1', at: '2026-06-01T05:30:00Z', views: 2 },
                  { video_id: 'v1', at: '2026-06-01T06:00:00Z', views: 3 }];
    expect(survivingReadings(rows, NOW)).toHaveLength(2);   // first and last of the day only
    expect(inLaunchWindow(rows[0])).toBe(false);
    expect(inLaunchDense(rows[0])).toBe(false);
  });

  test('the two windows are what READING_RETENTION says they are', () => {
    expect(inLaunchDense(p(READING_RETENTION.launchDenseHours * 60 - 1))).toBe(true);
    expect(inLaunchDense(p(READING_RETENTION.launchDenseHours * 60 + 1))).toBe(false);
    expect(inLaunchWindow(p(READING_RETENTION.launchWindowDays * 1440 - 1))).toBe(true);
    expect(inLaunchWindow(p(READING_RETENTION.launchWindowDays * 1440 + 1))).toBe(false);
  });

  test("the first reading with views > 0 survives even when a zero reading precedes it", () => {
    // growthExponent() drops non-positive readings, so the first POSITIVE one is the one it
    // reads. Thinning it away would move q and with it the score.
    const d = 1440;
    const rows = [p(5 * d, 0), p(5 * d + 10, 500), p(5 * d + 20, 600), p(5 * d + 900, 900)];
    const kept = survivingReadings(rows, NOW).map((x) => x.views);
    expect(kept).toContain(0);
    expect(kept).toContain(500);
    expect(kept).not.toContain(600);
  });
});

describe('partition keys', () => {
  test('the layout is the one the archive documents', () => {
    expect(readingsKey('rss', '2026-09-01')).toBe('readings/source=rss/day=2026-09-01/part-0.parquet');
    expect(readingsKey('api', '2026-09-01', 2)).toBe('readings/source=api/day=2026-09-01/part-2.parquet');
    expect(readingsIndexKey('rss', '2026-09-01')).toBe('readings/source=rss/day=2026-09-01/index.json');
    expect(historyKey('2026-09-01')).toBe('history/day=2026-09-01/part-0.parquet');
  });

  test('a key is never built from something that is not a UTC day', () => {
    for (const bad of ['2026-9-1', '20260901', '2026-09-01T00:00:00Z', '../../etc', '']) {
      expect(() => assertDay(bad)).toThrow();
      expect(() => readingsKey('rss', bad)).toThrow();
    }
  });

  test('the same day always lands on the same key, so a re-run overwrites', () => {
    expect(readingsKey('rss', '2026-09-01')).toBe(readingsKey('rss', '2026-09-01'));
  });
});

describe('archive ordering and the row index', () => {
  const rows = [r('b', '2026-06-01T02:00:00Z', 2), r('a', '2026-06-01T03:00:00Z', 3),
                r('a', '2026-06-01T01:00:00Z', 1), r('b', '2026-06-01T01:00:00Z', 9)];

  test('rows sort by video_id then time', () => {
    expect(sortForArchive(rows).map((x) => `${x.video_id}${x.views}`)).toEqual(['a1', 'a3', 'b9', 'b2']);
  });

  test('each video is one contiguous run, which is what the index records', () => {
    const idx = buildRowIndex(sortForArchive(rows));
    expect(idx).toEqual({ a: [0, 2], b: [2, 2] });
  });

  test('a video that is not in the day is not in the index', () => {
    expect(buildRowIndex(sortForArchive(rows)).zzz).toBeUndefined();
  });
});

describe('checksum', () => {
  const rows = [r('a', '2026-06-01T01:00:00Z', 1), r('b', '2026-06-01T02:00:00Z', 2)];

  test('covers exactly (video_id, at, views)', () => {
    expect(checksumLines(rows)).toBe('a|1780275600000|1\nb|1780279200000|2');
  });

  test('is order-independent on input, because it sorts first', () => {
    expect(checksum([...rows].reverse())).toBe(checksum(rows));
  });

  test('changes when a view count changes', () => {
    expect(checksum([r('a', '2026-06-01T01:00:00Z', 1)]))
      .not.toBe(checksum([r('a', '2026-06-01T01:00:00Z', 2)]));
  });

  test('changes when a row goes missing', () => {
    expect(checksum(rows.slice(0, 1))).not.toBe(checksum(rows));
  });

  test('a null view count is distinct from zero', () => {
    expect(checksum([{ video_id: 'a', at: '2026-06-01T01:00:00Z', views: null }]))
      .not.toBe(checksum([r('a', '2026-06-01T01:00:00Z', 0)]));
  });

  test('the streaming form agrees with the batch form, in archive order', () => {
    const s = checksumStream();
    s.push(sortForArchive(rows).slice(0, 1));
    s.push(sortForArchive(rows).slice(1));
    expect(s.rows).toBe(2);
    expect(s.digest()).toBe(checksum(rows));
  });

  test('is 64 hex characters, which is what isThinnable checks for', () => {
    expect(checksum(rows)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('keyset batching', () => {
  const keys = Array.from({ length: 45 }, (_, i) => keyOf(r(`v${String(i).padStart(3, '0')}`, '2026-06-01T00:00:00Z', 0)));

  test('no batch is larger than the limit and none is lost', () => {
    const batches = keysetBatches(keys, 20);
    expect(batches.map((b) => b.length)).toEqual([20, 20, 5]);
    expect(batches.flat()).toHaveLength(keys.length);
  });

  test('batches are in key order and do not overlap', () => {
    const batches = keysetBatches(keys, 20);
    const flat = batches.flat().map((k) => k.video_id);
    expect(flat).toEqual([...flat].sort());
    expect(new Set(flat).size).toBe(flat.length);
  });

  test('the cursor is the last key handled, so the next pass resumes after it', () => {
    const batches = keysetBatches(keys, 20);
    expect(cursorAfter(batches[0])!.video_id).toBe('v019');
    expect(batches[1][0].video_id > cursorAfter(batches[0])!.video_id).toBe(true);
    expect(cursorAfter([])).toBeNull();
  });

  test('an absurd batch size is rejected rather than producing one huge statement', () => {
    for (const bad of [0, -1, 1.5, NaN]) expect(() => keysetBatches(keys, bad)).toThrow();
  });

  test('videosPerBatch keeps a statement under the row limit', () => {
    expect(videosPerBatch(96) * 96).toBeLessThanOrEqual(READING_RETENTION.batchSize);
    expect(videosPerBatch(2) * 2).toBeLessThanOrEqual(READING_RETENTION.batchSize);
    expect(videosPerBatch(1_000_000)).toBe(1); // never zero videos, or the loop never advances
  });
});

describe('the survivor-must-be-verified rule', () => {
  const verified: ArchivedDay = {
    day: '2026-09-01', source: 'rss', rows: 10, bytes: 100,
    checksum: 'a'.repeat(64), verified_at: '2026-09-08T02:30:00Z',
  };
  const written: ArchivedDay = { ...verified, day: '2026-09-02', verified_at: null };

  test('a verified day may be thinned', () => {
    expect(isThinnable('2026-09-01', 'rss', [verified])).toBe(true);
    expect(() => assertThinnable('2026-09-01', 'rss', [verified])).not.toThrow();
  });

  test('a day written but not read back may NOT be thinned', () => {
    expect(isThinnable('2026-09-02', 'rss', [verified, written])).toBe(false);
    expect(() => assertThinnable('2026-09-02', 'rss', [verified, written])).toThrow(/not verified/);
  });

  test('a day absent from the ledger may NOT be thinned', () => {
    expect(isThinnable('2026-09-03', 'rss', [verified])).toBe(false);
    expect(() => assertThinnable('2026-09-03', 'rss', [])).toThrow(/not verified/);
  });

  test('verification of one source does not authorise another', () => {
    expect(isThinnable('2026-09-01', 'api', [verified])).toBe(false);
    expect(isThinnable('2026-09-01', 'history', [verified])).toBe(false);
  });

  test('a ledger row with a truncated checksum is not verification', () => {
    expect(isThinnable('2026-09-01', 'rss', [{ ...verified, checksum: 'abc' }])).toBe(false);
  });

  test('a verified EMPTY day is thinnable — there is nothing to lose', () => {
    expect(isThinnable('2026-09-01', 'rss', [{ ...verified, rows: 0 }])).toBe(true);
  });

  test('thinnableDays filters rather than throwing, so one bad day cannot stop the pass', () => {
    expect(thinnableDays(['2026-09-01', '2026-09-02', '2026-09-03'], 'rss', [verified, written]))
      .toEqual(['2026-09-01']);
  });
});

describe('day arithmetic', () => {
  test('dayRange is inclusive at both ends and oldest first', () => {
    expect(dayRange('2026-09-01T05:00:00Z', '2026-09-04T23:00:00Z'))
      .toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    expect(dayRange('2026-09-01', '2026-09-01')).toEqual(['2026-09-01']);
  });

  test('the newest archivable day is a full dense window behind now', () => {
    expect(newestArchivableDay(NOW)).toBe('2026-09-04');
  });

  test('utcDay/utcHour are UTC, not local', () => {
    expect(utcDay('2026-09-01T23:59:59Z')).toBe('2026-09-01');
    expect(utcHour('2026-09-01T23:59:59Z')).toBe('2026-09-01T23');
  });
});

describe('the SQL agrees with the pure policy', () => {
  test('the hourly and daily buckets partition on the same thing the TypeScript does', () => {
    expect(thinBatchSql('rss', 'hour')).toContain("date_trunc('hour', s0.at at time zone 'UTC')");
    expect(thinBatchSql('rss', 'day')).toContain("date_trunc('day',  s0.at at time zone 'UTC')");
    expect(thinBatchSql('rss', 'hour')).toContain('order by s0.at asc, s0.ctid asc'); // first-of-day guard
    expect(thinBatchSql('api', 'hour')).toContain("date_trunc('hour', s0.sampled_at at time zone 'UTC')");
  });

  test('the tie-break matches retention.ts newer(): latest first, then ctid', () => {
    expect(thinBatchSql('rss', 'hour')).toContain('order by s0.at desc, s0.ctid desc');
  });

  test('only rn > 1 is deleted, and never the first row of a day', () => {
    expect(thinBatchSql('rss', 'hour')).toContain('where rn > 1 and rn_first > 1 and not launch_dense');
  });

  test('every delete is bounded to one day AND an explicit video list', () => {
    for (const bucket of ['hour', 'day'] as const) {
      for (const source of ['rss', 'api'] as const) {
        const sql = thinBatchSql(source, bucket);
        expect(sql).toContain('$1::date');
        expect(sql).toContain('s0.video_id = any($2)');
      }
    }
  });

  test('the keyset scan walks video_id forward, which is the leading pk column', () => {
    expect(nextVideosSql('rss')).toContain('video_id collate "C" > $2');
    expect(nextVideosSql('rss')).toContain('order by video_id collate "C" limit $3');
    expect(tableFor('rss').table).toBe('rss_samples');
    expect(tableFor('api').table).toBe('view_samples');
  });

  test('the launch window is in the SQL too, in both the bucket and the guard', () => {
    const daily = thinBatchSql('rss', 'day');
    expect(daily).toContain(`interval '${READING_RETENTION.launchWindowDays} days'`);
    expect(daily).toContain(`interval '${READING_RETENTION.launchDenseHours} hours'`);
    expect(daily).toContain('join videos v on v.id = s0.video_id');
    expect(thinBatchSql('rss', 'hour')).toContain(`interval '${READING_RETENTION.launchDenseHours} hours'`);
  });

  test('the first-positive-of-day partition matches the TypeScript rule', () => {
    expect(thinBatchSql('rss', 'hour')).toContain('(coalesce(s0.views, 0) > 0)');
    expect(thinBatchSql('api', 'hour')).toContain('(coalesce(s0.view_count, 0) > 0)');
  });

  // The database default collation is en_US.UTF-8, which orders YouTube ids differently from
  // JavaScript's `<`. Every read that feeds the parquet file or the keyset walk must be byte-wise
  // or the checksum is computed over a different order than the file was written in.
  test('every video_id ordering and comparison is byte-wise', () => {
    for (const source of ['rss', 'api'] as const) {
      expect(selectDaySql(source)).toContain('order by video_id collate "C"');
      expect(selectDayForVideosSql(source)).toContain('order by video_id collate "C"');
      expect(nextVideosSql(source)).toContain('collate "C"');
    }
  });

  test('an unknown source cannot be turned into SQL', () => {
    expect(() => tableFor('videos' as never)).toThrow();
  });
});
