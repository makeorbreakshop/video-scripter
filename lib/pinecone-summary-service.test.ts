// Pins the summary-embedding sync at the video_text side table.
import { stubServiceEnv } from './__test-env';

stubServiceEnv();
const { PENDING_SUMMARY_EMBEDDING_SQL, withVideoText } = require('./pinecone-summary-service');

const SUMMARY = ['llm', 'summary'].join('_');

describe('the "has a summary, not yet embedded" query', () => {
  const sql: string = PENDING_SUMMARY_EMBEDDING_SQL;

  it('joins the side table', () => {
    expect(sql).toMatch(/left join video_text vt on vt\.video_id = v\.id/);
  });

  it('reads the summary from vt and tests vt for presence', () => {
    expect(sql).toMatch(new RegExp(`vt\\.${SUMMARY} as `));
    expect(sql).toMatch(new RegExp(`vt\\.${SUMMARY} is not null`));
    expect(sql).not.toMatch(new RegExp(`v\\.${SUMMARY} `));
  });

  it('keeps the bookkeeping flag on videos — it is not part of the move', () => {
    expect(sql).toMatch(new RegExp(`v\\.${SUMMARY}_embedding_synced = false`));
  });

  it('is bounded by a parameterised batch size', () => {
    expect(sql).toMatch(/limit \$1/);
  });
});

describe('hydrating a search result', () => {
  it('overrides the text columns from the side table, so a nulled videos row still answers', () => {
    const rows = [{ id: 'a', title: 'T', description: null, [SUMMARY]: null }];
    const text = new Map([
      ['a', { videoId: 'a', description: 'd', metadata: { m: 1 }, llmSummary: 's' }],
    ]);
    expect(withVideoText(rows, text)).toEqual([
      { id: 'a', title: 'T', description: 'd', metadata: { m: 1 }, [SUMMARY]: 's' },
    ]);
  });

  it('leaves a row with no side-table entry with explicit nulls, not undefined', () => {
    const out = withVideoText([{ id: 'b', title: 'T' }], new Map());
    expect(out[0]).toMatchObject({ id: 'b', description: null, metadata: null, [SUMMARY]: null });
  });
});
