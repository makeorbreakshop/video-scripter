// Format classification never owned the text columns — it is handed titles and descriptions by
// its caller — but it does write a row back to `videos`, and this pins that write so a future
// edit cannot quietly re-introduce one of the three moved columns.
import { stubServiceEnv } from './__test-env';

stubServiceEnv();
const { formatClassificationUpdate, FORMAT_UPDATE_COLUMNS } = require('./llm-format-classification-service');

const SUMMARY = ['llm', 'summary'].join('_');

describe('the classification write', () => {
  const payload = formatClassificationUpdate(
    { videoId: 'a', format: 'tutorial', confidence: 0.9, reasoning: 'because' },
    '2026-09-14T00:00:00.000Z',
  );

  it('touches none of the moved text columns', () => {
    for (const c of ['description', 'metadata', SUMMARY]) {
      expect(Object.keys(payload)).not.toContain(c);
      expect(FORMAT_UPDATE_COLUMNS).not.toContain(c);
    }
  });

  it('writes exactly the classification columns it always did', () => {
    expect(payload).toEqual({
      format_type: 'tutorial',
      format_confidence: 0.9,
      format_primary: 'tutorial',
      classification_llm_used: true,
      classification_timestamp: '2026-09-14T00:00:00.000Z',
    });
    expect(FORMAT_UPDATE_COLUMNS).toEqual(Object.keys(payload));
  });
});
