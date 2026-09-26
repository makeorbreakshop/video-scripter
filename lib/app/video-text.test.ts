// The read/write SQL the llm-summary workers run, pinned here rather than in the worker.
//
// The seven workers/llm-summary-* variants each carried their own copy of two queries:
// "videos with no summary yet" and "write the summary back". Both named `videos.llm_summary`
// directly, so all seven would have silently reprocessed the entire 1.1 M-row corpus the
// moment the null-out ran — `is('llm_summary', null)` matches every row once the column is
// NULL. They are consolidated into one worker and the SQL lives here, next to the accessor
// that owns these columns.
import {
  VIDEO_TEXT_JOIN, needsSummaryBatchSql, NEEDS_SUMMARY_COUNT_SQL,
  LLM_SUMMARY_UPSERT_SQL, VIDEO_TEXT_UPSERT_SQL,
  needsSummaryEmbeddingBatchSql, NEEDS_SUMMARY_EMBEDDING_COUNT_SQL,
} from './video-text';

describe('the summary worker read path', () => {
  const sql = needsSummaryBatchSql();

  it('decides "needs a summary" from video_text, never from videos.llm_summary alone', () => {
    // The whole point. After the null-out, `v.llm_summary is null` is true for every row.
    expect(sql).not.toMatch(/\bv\.llm_summary\s+is\s+null\b/i);
    expect(sql).toMatch(/coalesce\(vt\.llm_summary, v\.llm_summary\) is null/);
  });

  it('reads the description through the side table, coalescing rows the mover has not reached', () => {
    expect(sql).toMatch(/coalesce\(vt\.description, v\.description\)/);
    expect(sql).toContain(VIDEO_TEXT_JOIN);
  });

  it('is a bounded keyset walk, not an OFFSET over 1.1 M rows', () => {
    expect(sql).toMatch(/v\.id > \$1/);
    expect(sql).toMatch(/order by v\.id/);
    expect(sql).toMatch(/limit \$2/);
    expect(sql).not.toMatch(/\boffset\b/i);
  });

  it('counts the outstanding work the same way it selects it', () => {
    expect(NEEDS_SUMMARY_COUNT_SQL).toMatch(/coalesce\(vt\.llm_summary, v\.llm_summary\) is null/);
    expect(NEEDS_SUMMARY_COUNT_SQL).toContain(VIDEO_TEXT_JOIN);
  });
});

describe('the summary worker write path', () => {
  it('writes the summary to video_text and to no column of `videos`', () => {
    expect(LLM_SUMMARY_UPSERT_SQL).toMatch(/insert into video_text/);
    expect(LLM_SUMMARY_UPSERT_SQL).not.toMatch(/update\s+videos\b/i);
    expect(LLM_SUMMARY_UPSERT_SQL).toMatch(/on conflict \(video_id\) do update/);
  });

  it('touches only llm_summary — it must not blank a description it was never given', () => {
    // A summary write carries no description or metadata. Reusing VIDEO_TEXT_UPSERT_SQL here
    // would set both to NULL for every row it touched, which is the whole corpus.
    expect(LLM_SUMMARY_UPSERT_SQL).not.toMatch(/set[\s\S]*description\s*=/i);
    expect(LLM_SUMMARY_UPSERT_SQL).not.toMatch(/set[\s\S]*metadata\s*=/i);
    expect(VIDEO_TEXT_UPSERT_SQL).toMatch(/description = coalesce\(excluded\.description, video_text\.description\)/); // the full-row form still does
  });
});

describe('the vectorization worker read path', () => {
  const sql = needsSummaryEmbeddingBatchSql();

  it('finds "has a summary" through the side table, not through videos.llm_summary', () => {
    // The inverse of the generation worker's bug, and just as quiet: after the null-out
    // `v.llm_summary is not null` is false everywhere, so the vectorization worker would
    // report zero work outstanding for ever and the semantic layer would stop being filled.
    expect(sql).not.toMatch(/\bv\.llm_summary\s+is\s+not\s+null\b/i);
    expect(sql).toMatch(/coalesce\(vt\.llm_summary, v\.llm_summary\) is not null/);
    expect(sql).toContain(VIDEO_TEXT_JOIN);
  });

  it('still reads the sync flag off `videos`, which is where it lives and stays', () => {
    expect(sql).toMatch(/v\.llm_summary_embedding_synced = false/);
  });

  it('returns the summary text itself, coalesced', () => {
    expect(sql).toMatch(/coalesce\(vt\.llm_summary, v\.llm_summary\) as llm_summary/);
  });

  it('is a bounded keyset walk', () => {
    expect(sql).toMatch(/v\.id > \$1/);
    expect(sql).toMatch(/limit \$2/);
    expect(sql).not.toMatch(/\boffset\b/i);
  });

  it('counts with the predicate it selects with', () => {
    expect(NEEDS_SUMMARY_EMBEDDING_COUNT_SQL).toMatch(/coalesce\(vt\.llm_summary, v\.llm_summary\) is not null/);
    expect(NEEDS_SUMMARY_EMBEDDING_COUNT_SQL).toMatch(/v\.llm_summary_embedding_synced = false/);
  });
});

describe('the full-row upsert never blanks text it was not given (review P0-1, 2026-09-26)', () => {
  // lib/unified-video-import.ts writes rows with no llm_summary. With `llm_summary =
  // excluded.llm_summary` every re-import set the side copy to NULL — harmless while videos still
  // held a copy, permanent loss once the null-out had cleared it.
  it.each(['description', 'metadata', 'llm_summary'])('keeps the existing %s when the write carries NULL', (c) => {
    expect(VIDEO_TEXT_UPSERT_SQL).toMatch(new RegExp(`${c} = coalesce\\(excluded\\.${c}, video_text\\.${c}\\)`));
  });
});
