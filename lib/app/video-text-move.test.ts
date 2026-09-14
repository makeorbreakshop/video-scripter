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
  TEXT_COLUMNS, MIRROR_TRIGGER_SQL, NULL_COVERAGE_SQL, MOVED_COUNT_SQL,
  nullCountRemainingSql, nullVerifySql,
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

  it('does not call a NULL original a disagreement — there is nothing there to lose', () => {
    // Once the writers stop populating videos.description/metadata/llm_summary and write only
    // to video_text, the ordinary state of a freshly-summarised row is: videos.llm_summary
    // NULL, video_text.llm_summary a real summary. The bare `is distinct from` form calls that
    // a disagreement, so the gate would refuse to let the null-out run at all — on rows where
    // there is, by definition, nothing to destroy. The gate exists to protect text that only
    // `videos` holds, so it must look only at originals that are not null.
    for (const c of TEXT_COLUMNS) {
      expect(NULL_VERIFY_SQL).toMatch(new RegExp(`v\\.${c} is not null and v\\.${c} is distinct from vt\\.${c}`));
    }
  });

  it('counts what remains against videos that have been moved', () => {
    expect(NULL_COUNT_REMAINING_SQL).toMatch(/join video_text/);
  });
});


describe('the mirror trigger, which the null-out must not run underneath', () => {
  it('is looked for by name before anything is cleared', () => {
    // THE HAZARD THIS EXISTS FOR. sql/2026-09-08-video-text.sql installs
    // video_text_mirror_upd: AFTER UPDATE ON videos, WHEN one of the three columns changed,
    // copy the NEW values into video_text. nullBatchSql() is an UPDATE that sets all three to
    // NULL. The trigger fires on exactly that update and writes NULL into video_text — so the
    // null-out would not free 2 GB of text, it would DELETE the only remaining copy of it,
    // row by row, with the verification gate satisfied at every step because the two copies
    // would indeed agree: both NULL.
    //
    // The trigger has to be dropped before the null-out, and the null-out has to check.
    expect(MIRROR_TRIGGER_SQL).toMatch(/pg_trigger/);
    expect(MIRROR_TRIGGER_SQL).toMatch(/video_text_mirror/);
    expect(MIRROR_TRIGGER_SQL).toMatch(/videos'::regclass/);
  });

  it('looks for the UPDATE trigger specifically, not just any trigger on videos', () => {
    expect(MIRROR_TRIGGER_SQL).not.toMatch(/select \* from pg_trigger\s*$/i);
    expect(MIRROR_TRIGGER_SQL).toMatch(/not tgisinternal/);
  });
});

describe('the dry-run coverage report', () => {
  it('splits the sample into the three states the null-out cares about', () => {
    for (const bucket of ['verified_equal', 'disagree', 'already_clear', 'sampled']) {
      expect(NULL_COVERAGE_SQL).toContain(bucket);
    }
  });

  it('classifies a disagreement by which column disagrees, so a report is actionable', () => {
    for (const c of TEXT_COLUMNS) expect(NULL_COVERAGE_SQL).toContain(`disagree_${c}`);
  });

  it('never scans `videos` — it drives off video_text and joins in by primary key', () => {
    // The left-joined form of this query is a seq scan of a 1,734 MB heap. It was written that
    // way, run once on 2026-09-14, and cancelled by the 120-second statement timeout.
    expect(NULL_COVERAGE_SQL).not.toMatch(/from videos v/);
    expect(NULL_COVERAGE_SQL).toMatch(/from video_text vt/);
    expect(NULL_COVERAGE_SQL).toMatch(/join videos v on v\.id = s\.video_id/);
  });

  it('is bounded — the sample takes a LIMIT', () => {
    expect(NULL_COVERAGE_SQL).toMatch(/limit \$1/);
  });

  it('counts what has been moved over video_text alone, not over the wide table', () => {
    expect(MOVED_COUNT_SQL).toMatch(/from video_text/);
    expect(MOVED_COUNT_SQL).not.toMatch(/videos/);
  });
});

describe('clearing one column at a time', () => {
  // The three columns did not become safe together, and waiting for the slowest is a choice to
  // reclaim nothing. As of 2026-09-14 the sweep says: llm_summary 0 direct readers,
  // description 10, metadata 18. So llm_summary can be cleared now and the other two cannot.
  const only = ['llm_summary'] as const;

  it('clears exactly the columns it was given', () => {
    const sql = nullBatchSql(only);
    expect(sql).toMatch(/llm_summary = null/);
    expect(sql).not.toMatch(/description = null/);
    expect(sql).not.toMatch(/metadata = null/);
  });

  it('proves equality only for the columns it is about to clear', () => {
    // Requiring description to agree before clearing llm_summary would block every row whose
    // description the mover has not reached — which is 98 % of them.
    const sql = nullBatchSql(only);
    expect(sql).toMatch(/v\.llm_summary is not distinct from vt\.llm_summary/);
    expect(sql).not.toMatch(/v\.description is not distinct from vt\.description/);
  });

  it('stays idempotent within the columns it clears', () => {
    expect(nullBatchSql(only)).toMatch(/\(v\.llm_summary is not null\)/);
  });

  it('still defaults to all three, so nothing silently narrows', () => {
    const sql = nullBatchSql();
    for (const c of TEXT_COLUMNS) expect(sql).toMatch(new RegExp(`${c} = null`));
  });

  it('refuses an empty column list rather than emitting `set` with nothing after it', () => {
    expect(() => nullBatchSql([] as any)).toThrow(/at least one column/i);
  });

  it('refuses a column that is not one of the three', () => {
    expect(() => nullBatchSql(['title'] as any)).toThrow(/title/);
  });

  it('scopes the remaining-work count and the verification gate the same way', () => {
    expect(nullCountRemainingSql(only)).toMatch(/v\.llm_summary is not null/);
    expect(nullCountRemainingSql(only)).not.toMatch(/v\.description/);
    expect(nullVerifySql(only)).toMatch(/v\.llm_summary is not null and v\.llm_summary is distinct from vt\.llm_summary/);
    expect(nullVerifySql(only)).not.toMatch(/v\.description/);
  });
});
