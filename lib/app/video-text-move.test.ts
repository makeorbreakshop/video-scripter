// The SQL behind scripts/move-video-text.ts and scripts/null-video-text.ts.
//
// THE DEFECT THIS IS WRITTEN FOR (2026-09-09..14): the mover resumed from
// `select max(video_id) from video_text`. A mirror trigger inserts every newly ingested video
// into video_text as it arrives, so that max was a fresh id near the top of the key space. The
// walk started there, found almost nothing above it, and reported success after 19,659 of
// 1,107,961 rows — for six nights, while `videos` stayed at 4 GB.
import {
  moveBatchSql, MOVE_COUNT_REMAINING_SQL,
  nullBatchSql, NULL_COUNT_REMAINING_SQL, NULL_VERIFY_SQL,
  TEXT_COLUMNS,
} from './video-text-move';

describe('the mover cursor', () => {
  const sql = moveBatchSql(false);

  it('never derives its resume point from video_text', () => {
    // The whole defect in one assertion. The cursor is a parameter driven by the walk over
    // `videos`; nothing about where to resume may come from the destination table, because the
    // trigger keeps the destination's max fresh.
    expect(sql).not.toMatch(/max\s*\(\s*video_id\s*\)/i);
    expect(sql).not.toMatch(/max\s*\(\s*vt\./i);
  });

  it('walks `videos` in primary-key order from a parameterised cursor', () => {
    expect(sql).toMatch(/from videos v\s+where v\.id > \$1/);
    expect(sql).toMatch(/order by v\.id/);
    expect(sql).not.toMatch(/\boffset\b/i); // a 1.1 M-row OFFSET walk is quadratic
  });

  it('selects only videos not already in video_text (anti-join, not a cursor guess)', () => {
    expect(sql).toMatch(/not exists\s*\(\s*select 1 from video_text vt where vt\.video_id = v\.id\s*\)/);
  });

  it('is bounded: every batch takes a LIMIT', () => {
    expect(sql).toMatch(/limit \$2/);
  });

  it('is idempotent: a re-run of the same batch overwrites rather than duplicating', () => {
    expect(sql).toMatch(/on conflict \(video_id\) do update/);
  });

  it('moves exactly the three columns that are 86 % of a videos row, and no others', () => {
    expect(TEXT_COLUMNS).toEqual(['description', 'metadata', 'llm_summary']);
    for (const c of TEXT_COLUMNS) expect(sql).toContain(c);
  });

  it('the dry-run form writes nothing', () => {
    const dryRun = moveBatchSql(true);
    expect(dryRun).not.toMatch(/\binsert\b/i);
    expect(dryRun).not.toMatch(/\bupdate\b/i);
  });

  it('reports what is left over the whole table, not over what has been moved', () => {
    expect(MOVE_COUNT_REMAINING_SQL).toMatch(/from videos v/);
    expect(MOVE_COUNT_REMAINING_SQL).toMatch(/not exists/);
  });
});

describe('the null-out', () => {
  const sql = nullBatchSql();

  it('nulls only rows whose copy in video_text is byte-for-byte equal', () => {
    // `is not distinct from` and not `=`: `=` is null-propagating, so a row where both copies
    // are NULL would not match and would never be cleared, and — far worse — a row where the
    // side copy is NULL against a real description would compare UNKNOWN, not false. Nulling on
    // an UNKNOWN would destroy the only copy.
    for (const c of TEXT_COLUMNS) {
      expect(sql).toMatch(new RegExp(`v\\.${c} is not distinct from vt\\.${c}`));
    }
    expect(sql).not.toMatch(/v\.description = vt\.description/);
  });

  it('requires a video_text row to exist at all — an unmoved video is never touched', () => {
    expect(sql).toMatch(/join video_text vt on vt\.video_id = v\.id/);
    expect(sql).not.toMatch(/left join video_text/);
  });

  it('sets exactly the three columns to NULL', () => {
    for (const c of TEXT_COLUMNS) expect(sql).toMatch(new RegExp(`${c} = null`));
  });

  it('is bounded and resumable: keyset cursor, ordered, limited', () => {
    expect(sql).toMatch(/v\.id > \$1/);
    expect(sql).toMatch(/order by v\.id/);
    expect(sql).toMatch(/limit \$2/);
    expect(sql).not.toMatch(/\boffset\b/i);
  });

  it('is idempotent: an already-nulled row is not selected a second time', () => {
    // All three already NULL and equal to a NULL side copy would otherwise match forever.
    expect(sql).toMatch(/v\.description is not null or v\.metadata is not null or v\.llm_summary is not null/);
  });

  it('returns the ids it changed, so the cursor advances on fact not on hope', () => {
    expect(sql).toMatch(/returning/i);
  });

  it('the verification query looks for DISAGREEMENT, and finds none when all is well', () => {
    for (const c of TEXT_COLUMNS) {
      expect(NULL_VERIFY_SQL).toMatch(new RegExp(`v\\.${c} is distinct from vt\\.${c}`));
    }
  });

  it('counts what remains against videos that have been moved', () => {
    expect(NULL_COUNT_REMAINING_SQL).toMatch(/join video_text/);
  });
});
