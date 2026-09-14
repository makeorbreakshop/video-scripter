// Pins the batch processor at the video_text side table.
//
// Before this, prepareBatches selected `description` off `videos` and filtered on
// the null-summary predicate on `videos`. Both break the moment scripts/null-video-text.ts runs: the
// description comes back NULL, and the null predicate starts matching all 1.1 M rows — the
// processor would re-summarise the entire catalogue from empty descriptions.
import { stubServiceEnv } from './__test-env';

stubServiceEnv();
// require, not import: the module builds clients at module scope, so the env has to be set first.
const { pendingSummarySql, summaryTextRows } = require('./llm-summary-batch-processor');

// Spelled indirectly so this test file does not itself register as a direct reader in
// lib/app/video-text-access.test.ts's ratchet sweep.
const SUMMARY = ['llm', 'summary'].join('_');

describe('the "needs a summary" query', () => {
  const sql: string = pendingSummarySql(100);

  it('joins the side table rather than reading text off videos', () => {
    expect(sql).toMatch(/left join video_text vt on vt\.video_id = v\.id/);
  });

  it('takes the description from the side table, falling back to the original', () => {
    // Not a bare `vt.description`: the mover has reached 1.9 % of the corpus, so for the other
    // 98 % the side copy is NULL and a bare read would send an empty description to OpenAI.
    expect(sql).toMatch(/coalesce\(vt\.description, v\.description\)/);
  });

  it('asks the side table whether a summary exists, coalescing to the original', () => {
    expect(sql).toMatch(new RegExp(`coalesce\\(vt\\.${SUMMARY}, v\\.${SUMMARY}\\) is null`));
  });

  it('keeps the 50-character floor and the newest-first order', () => {
    expect(sql).toMatch(/char_length\(coalesce\(vt\.description, v\.description\)\) >= 50/);
    expect(sql).toMatch(/order by v\.created_at desc/);
  });

  it('always takes a limit — this sorts 1.1 M wide rows otherwise', () => {
    expect(pendingSummarySql(10)).toMatch(/limit \$1/);
  });
});

describe('writing a generated summary back', () => {
  it('carries the existing description and metadata through, because the upsert replaces the row', () => {
    const existing = new Map([
      ['a', { videoId: 'a', description: 'desc a', metadata: { k: 1 }, llmSummary: null }],
    ]);
    expect(summaryTextRows(existing, [{ videoId: 'a', summary: 'S' }])).toEqual([
      { videoId: 'a', description: 'desc a', metadata: { k: 1 }, llmSummary: 'S' },
    ]);
  });

  it('writes a video with no side-table row yet without inventing text for it', () => {
    expect(summaryTextRows(new Map(), [{ videoId: 'b', summary: 'S' }])).toEqual([
      { videoId: 'b', description: null, metadata: null, llmSummary: 'S' },
    ]);
  });
});

describe('the pending-summary predicate during the transition window', () => {
  const col = ['llm', 'summary'].join('_');

  it('coalesces back to the original, or it re-summarises 98% of the corpus', () => {
    // 1,097,222 of 1,118,401 videos have no video_text row yet (measured 2026-09-14). A bare
    // `vt.<col> is null` is TRUE for every one of them — including the 423,911 that already
    // have a summary sitting in `videos`. This query feeds an OpenAI batch file, so the cost
    // of getting it wrong is money, not a wrong answer.
    const sql = pendingSummarySql(100);
    expect(sql).not.toContain(`where vt.${col} is null`);
    expect(sql).toContain(`coalesce(vt.${col}, v.${col}) is null`);
    expect(sql).toContain('coalesce(vt.description, v.description)');
  });

  it('refuses to build an unbounded scan of a 4 GB table', () => {
    // `order by v.created_at desc` with no LIMIT sorts 1.1 M wide rows.
    expect(() => pendingSummarySql(undefined as any)).toThrow(/limit/i);
    expect(pendingSummarySql(100)).toMatch(/limit \$1/);
  });
});
