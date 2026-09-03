import { parseInspirationFeedback, validateInspirationFeedbackReceipt } from './inspiration-feedback-core';

describe('inspiration feedback payload mapping', () => {
  const valid = {
    target_channel_id: 'UCjWkNxpp3UHdEavpM_19--Q',
    video_id: 'MpGDoiSH_PQ',
    distance: 'far',
    decision: 'saved',
    rank: '7',
  };

  test('maps only the bounded fields the server is willing to persist', () => {
    expect(parseInspirationFeedback(valid)).toEqual({
      targetChannelId: valid.target_channel_id,
      videoId: valid.video_id,
      distance: 'far',
      decision: 'saved',
      rank: 7,
    });
    expect(parseInspirationFeedback({ ...valid, decision: 'clear' }).decision).toBe('clear');
  });

  test('rejects invalid identities, decisions, distances, and ranks', () => {
    expect(() => parseInspirationFeedback({ ...valid, target_channel_id: 'not-a-channel' })).toThrow(/channel/i);
    expect(() => parseInspirationFeedback({ ...valid, video_id: 'not-a-video-id' })).toThrow(/video/i);
    expect(() => parseInspirationFeedback({ ...valid, decision: 'approved' })).toThrow(/decision/i);
    expect(() => parseInspirationFeedback({ ...valid, distance: 'extreme' })).toThrow(/distance/i);
    expect(() => parseInspirationFeedback({ ...valid, rank: '0' })).toThrow(/rank/i);
    expect(() => parseInspirationFeedback({ ...valid, rank: '25' })).toThrow(/rank/i);
  });

  test('accepts feedback only for the exact returned video and rank', () => {
    const input = parseInspirationFeedback(valid);
    expect(validateInspirationFeedbackReceipt(input, [
      { videoId: 'another_vid', rank: 1 },
      { videoId: valid.video_id, rank: 7 },
    ])).toEqual(input);
    expect(() => validateInspirationFeedbackReceipt(input, [
      { videoId: valid.video_id, rank: 6 },
    ])).toThrow(/returned result/i);
    expect(() => validateInspirationFeedbackReceipt(input, [
      { videoId: 'another_vid', rank: 7 },
    ])).toThrow(/returned result/i);
  });
});
