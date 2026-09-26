// The SQL behind scripts/move-video-text.ts and scripts/null-video-text.ts.
//
// THE DEFECT THIS IS WRITTEN FOR (2026-09-09..14): the mover resumed from
// `select max(video_id) from video_text`. A mirror trigger inserts every newly ingested video
// into video_text as it arrives, so that max was a fresh id near the top of the key space. The
// walk started there, found almost nothing above it, and reported success after 19,659 of
// 1,107,961 rows — for six nights, while `videos` stayed at 4 GB.
import {
  moveWindowSql, nullWindowSql, CLEARED_COLUMNS,
  TEXT_COLUMNS, MIRROR_TRIGGER_SQL, NULL_COVERAGE_SQL, MOVED_COUNT_SQL,
  LLM_SUMMARY_HOLDING_SQL,
} from './video-text-move';

// THE SECOND DEFECT (2026-09-15 .. 09-26): the mover's batch was `where v.id > $1 and not exists
// (…video_text…) order by v.id limit 2000`. Once the unmoved rows were sparse — 4,853 of
// 1.17 M — one statement had to walk the whole primary key to find 2,000 of them, and the
// 120 s statement timeout killed it (57014 in logs/move-video-text-launchd.err.log, 9.6 MB of
// temp spill per call in pg_stat_statements). The cure is a window: each statement looks at the
// next N primary keys, whatever it finds there, and says where it stopped.
describe('the mover walks the primary key in bounded windows', () => {
  const sql = moveWindowSql(false);

  it('never derives its resume point from video_text', () => {
    expect(sql).not.toMatch(/max\s*\(\s*video_id\s*\)/i);
    expect(sql).not.toMatch(/max\s*\(\s*vt\./i);
  });

  it('bounds every statement to a window of primary keys, however sparse the work is', () => {
    expect(sql).toMatch(/select id from videos where id > \$1 order by id limit \$2/);
    expect(sql).not.toMatch(/\boffset\b/i);
  });

  it('returns where the window ended, so the cursor advances even when nothing was moved', () => {
    expect(sql).toMatch(/as next_cursor/);
    expect(sql).toMatch(/as scanned/);
    expect(sql).toMatch(/as moved/);
  });

  it('anti-joins video_text: only videos with no side row are copied', () => {
    expect(sql).toMatch(/not exists\s*\(\s*select 1 from video_text vt where vt\.video_id = win\.id\s*\)/);
    // …on the window's keys alone, before any wide `videos` row is fetched.
    expect(sql).toMatch(/unmoved as materialized/);
    expect(sql).toMatch(/from unmoved u join videos v on v\.id = u\.id/);
  });

  it('never overwrites a side row a writer produced concurrently', () => {
    expect(sql).toMatch(/on conflict \(video_id\) do nothing/);
  });

  it('moves exactly the three columns, and no others', () => {
    expect(TEXT_COLUMNS).toEqual(['description', 'metadata', 'llm_summary']);
    for (const c of TEXT_COLUMNS) expect(sql).toContain(c);
  });

  it('the dry-run form writes nothing', () => {
    const dry = moveWindowSql(true);
    expect(dry).not.toMatch(/\binsert\b/i);
    expect(dry).not.toMatch(/\bupdate\b/i);
    expect(dry).toMatch(/as next_cursor/);
  });
});

describe('the null-out clears per row, per window, and proves each row first', () => {
  const sql = nullWindowSql(['llm_summary']);

  it('clears only rows whose side copy is byte-for-byte equal, checked on the UPDATE target', () => {
    // The predicate sits in the UPDATE's own WHERE, against `videos` as the target. Under READ
    // COMMITTED a row changed concurrently is re-checked against its NEW version (EvalPlanQual),
    // so a value written after our snapshot can never be nulled on the strength of an old match.
    expect(sql).toMatch(/update videos v\s+set llm_summary = null\s+from locked vt/);
    expect(sql).toMatch(/where vt\.video_id = v\.id/);
    expect(sql).toMatch(/v\.llm_summary is not distinct from vt\.llm_summary/);
    expect(sql).not.toMatch(/v\.llm_summary = vt\.llm_summary/);
  });

  it('requires a side row — an unmoved video is never touched', () => {
    expect(sql).toMatch(/from locked vt/);
    expect(sql).not.toMatch(/update videos v\s+set[^;]*left join/);
  });

  it('is idempotent: a row already clear is not selected again', () => {
    expect(sql).toMatch(/\(v\.llm_summary is not null\)/);
  });

  it('is bounded to a window of primary keys and reports where it stopped', () => {
    expect(sql).toMatch(/select id from videos where id > \$1 order by id limit \$2/);
    expect(sql).toMatch(/as next_cursor/);
    expect(sql).toMatch(/as cleared/);
  });

  it('counts, in the same window, what it could NOT clear and why', () => {
    expect(sql).toMatch(/as disagree/);
    expect(sql).toMatch(/as unmoved_holding/);
  });

  it('clears exactly the columns it was given', () => {
    expect(sql).toMatch(/llm_summary = null/);
    expect(sql).not.toMatch(/description = null/);
    expect(sql).not.toMatch(/metadata = null/);
    const all = nullWindowSql(TEXT_COLUMNS);
    for (const c of TEXT_COLUMNS) expect(all).toMatch(new RegExp(`${c} = null`));
  });

  it('refuses an empty list, or a column that is not one of the three', () => {
    expect(() => nullWindowSql([] as any)).toThrow(/at least one column/i);
    expect(() => nullWindowSql(['title'] as any)).toThrow(/title/);
  });

  it('has no corpus-wide count or scan anywhere in it', () => {
    // The old verify/remaining queries joined 1.17 M rows to 1.17 M rows with no index-backed
    // predicate; one of them was cancelled by the statement timeout on 2026-09-14.
    expect(sql).not.toMatch(/count\(\*\)[^)]*from videos v\s+join video_text/);
  });
});

describe('which columns are cleared is one list, shared by the null-out, the ingest and the ratchet', () => {
  it('is llm_summary alone until the description/metadata readers are repointed', () => {
    expect([...CLEARED_COLUMNS].sort()).toEqual(expect.arrayContaining(['llm_summary']));
    for (const c of CLEARED_COLUMNS) expect(TEXT_COLUMNS).toContain(c);
  });

  it('can say cheaply whether any llm_summary is still held on videos (partial-index count)', () => {
    expect(LLM_SUMMARY_HOLDING_SQL).toMatch(/where llm_summary is not null/);
    expect(LLM_SUMMARY_HOLDING_SQL).toMatch(/limit 1/);
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

  it('reports what has been moved from the catalog estimate — no scan of either table', () => {
    expect(MOVED_COUNT_SQL).toMatch(/reltuples/);
    expect(MOVED_COUNT_SQL).toMatch(/'video_text'::regclass/);
    expect(MOVED_COUNT_SQL).not.toMatch(/from videos|from video_text/);
  });
});

describe('the null-out locks the side rows it relies on (review P1-1, 2026-09-26)', () => {
  // EvalPlanQual re-reads the UPDATE target (`videos`) only. A side row changed or deleted after
  // the snapshot would still be trusted, so the proof is taken against rows locked FOR SHARE —
  // the latest committed version, held until commit.
  const sql = nullWindowSql(['llm_summary']);
  it('reads video_text for the window FOR SHARE and proves equality against those rows', () => {
    expect(sql).toMatch(/locked as \(\s*select vt\.video_id, vt\.llm_summary\s+from video_text vt\s+where vt\.video_id in \(select id from win\)\s+for share\s*\)/);
    expect(sql).toMatch(/update videos v\s+set llm_summary = null\s+from locked vt/);
  });
});
