import {
  RSS_RETENTION,
  survivingSamples,
  doomedSamples,
  THIN_BATCH_SQL,
  COUNT_OLD_SQL,
} from './retention';

const NOW = new Date('2026-10-15T12:00:00Z');
const row = (video_id: string, at: string, id?: number) => ({ video_id, at, id });

describe('survivingSamples', () => {
  it('keeps every reading inside the dense window untouched', () => {
    const dense = [
      row('a', '2026-10-15T11:45:00Z'),
      row('a', '2026-10-15T11:30:00Z'),
      row('a', '2026-09-20T00:00:00Z'), // 25 days old, still inside 30
    ];
    expect(survivingSamples(dense, NOW)).toEqual(dense);
    expect(doomedSamples(dense, NOW)).toEqual([]);
  });

  it('keeps only the LAST reading of each day past the window', () => {
    const old = [
      row('a', '2026-08-01T01:00:00Z'),
      row('a', '2026-08-01T13:00:00Z'),
      row('a', '2026-08-01T23:30:00Z'),
      row('a', '2026-08-02T04:00:00Z'),
    ];
    expect(survivingSamples(old, NOW).map((r) => r.at))
      .toEqual(['2026-08-01T23:30:00Z', '2026-08-02T04:00:00Z']);
    expect(doomedSamples(old, NOW)).toHaveLength(2);
  });

  it('thins per video, not across videos', () => {
    const old = [
      row('a', '2026-08-01T01:00:00Z'),
      row('b', '2026-08-01T02:00:00Z'),
      row('a', '2026-08-01T03:00:00Z'),
      row('b', '2026-08-01T04:00:00Z'),
    ];
    expect(survivingSamples(old, NOW).map((r) => [r.video_id, r.at]))
      .toEqual([['a', '2026-08-01T03:00:00Z'], ['b', '2026-08-01T04:00:00Z']]);
  });

  it('splits days on UTC, matching the SQL partition', () => {
    const old = [row('a', '2026-08-01T23:59:00Z'), row('a', '2026-08-02T00:01:00Z')];
    expect(survivingSamples(old, NOW)).toHaveLength(2);
  });

  it('breaks a same-instant tie on id, deterministically', () => {
    const old = [row('a', '2026-08-01T01:00:00Z', 1), row('a', '2026-08-01T01:00:00Z', 2)];
    expect(survivingSamples(old, NOW).map((r) => r.id)).toEqual([2]);
  });

  it('never deletes a row it cannot date', () => {
    const rows = [{ video_id: 'a', at: 'garbage' }, row('a', '2026-08-01T01:00:00Z'), row('a', '2026-08-01T02:00:00Z')];
    expect(doomedSamples(rows, NOW).map((r) => r.at)).toEqual(['2026-08-01T01:00:00Z']);
  });

  it('one dense day past the window collapses 96 readings to 1', () => {
    const day = Array.from({ length: 96 }, (_, i) =>
      row('a', new Date(Date.UTC(2026, 7, 1, 0, i * 15)).toISOString(), i));
    const kept = survivingSamples(day, NOW);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe(95);
  });

  it('is preserving on empty input and honours a custom window', () => {
    expect(survivingSamples([], NOW)).toEqual([]);
    const r = [row('a', '2026-10-14T01:00:00Z'), row('a', '2026-10-14T02:00:00Z')];
    expect(survivingSamples(r, NOW, 30)).toHaveLength(2); // inside 30 days
    expect(survivingSamples(r, NOW, 0)).toHaveLength(1);  // window closed: thin it
    expect(RSS_RETENTION.denseWindowDays).toBe(30);
  });
});

describe('THIN_BATCH_SQL', () => {
  it('expresses the same rule set-based: last row per video per UTC day, batched', () => {
    expect(THIN_BATCH_SQL).toContain("partition by video_id, (at at time zone 'UTC')::date");
    expect(THIN_BATCH_SQL).toContain('order by at desc, ctid desc');
    expect(THIN_BATCH_SQL).toContain('where rn > 1');
    expect(THIN_BATCH_SQL).toContain('limit $2');
    expect(THIN_BATCH_SQL).toContain("at < now() - ($1 || ' days')::interval");
    expect(THIN_BATCH_SQL).toContain('delete from rss_samples');
  });

  it('only ever touches rows outside the dense window', () => {
    for (const sql of [THIN_BATCH_SQL, COUNT_OLD_SQL]) {
      expect(sql).toContain("at < now() - ($1 || ' days')::interval");
    }
    expect(COUNT_OLD_SQL).not.toContain('delete');
  });
});
