// The import-time summary generator wrote the summary itself into `videos`. After the null-out
// that write is thrown away, so the summary has to land in video_text instead — while the
// bookkeeping columns (generated_at / model) stay on `videos`, where they are not part of the move.
import { stubServiceEnv } from './__test-env';

stubServiceEnv();
const { summaryTextRows, summaryBookkeepingUpdate } = require('./unified-import-summary-integration');

const SUMMARY = ['llm', 'summary'].join('_');

describe('the videos update that survives the move', () => {
  const payload = summaryBookkeepingUpdate('gpt-4o-mini', '2026-09-14T00:00:00.000Z');

  it('never writes the text column into videos again', () => {
    expect(Object.keys(payload)).not.toContain(SUMMARY);
    expect(Object.keys(payload)).not.toContain('description');
    expect(Object.keys(payload)).not.toContain('metadata');
  });

  it('still stamps when and with what the summary was generated', () => {
    expect(payload).toEqual({
      [`${SUMMARY}_generated_at`]: '2026-09-14T00:00:00.000Z',
      [`${SUMMARY}_model`]: 'gpt-4o-mini',
    });
  });
});

describe('the video_text rows', () => {
  it('preserves description and metadata already in the side table', () => {
    const existing = new Map([
      ['a', { videoId: 'a', description: 'd', metadata: { m: 1 }, llmSummary: 'old' }],
    ]);
    expect(summaryTextRows(existing, [{ videoId: 'a', summary: 'new' }])).toEqual([
      { videoId: 'a', description: 'd', metadata: { m: 1 }, llmSummary: 'new' },
    ]);
  });

  it('skips nothing and invents nothing for an unseen video', () => {
    expect(summaryTextRows(new Map(), [{ videoId: 'b', summary: 's' }])).toEqual([
      { videoId: 'b', description: null, metadata: null, llmSummary: 's' },
    ]);
  });
});
