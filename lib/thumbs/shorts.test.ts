import { verdictFromResponse } from './shorts';

describe('verdictFromResponse (youtube.com/shorts/<id>)', () => {
  test('200 means YouTube serves it as a Short', () => {
    expect(verdictFromResponse(200, null)).toBe('short');
  });
  test('a redirect to /watch means it is a regular video', () => {
    expect(verdictFromResponse(303, 'https://www.youtube.com/watch?v=Po_Dh7WLgmM')).toBe('long');
    expect(verdictFromResponse(302, '/watch?v=abc&feature=shorts_redirect')).toBe('long');
  });
  test('a redirect anywhere else, or 404/410, means the video is gone', () => {
    expect(verdictFromResponse(303, 'https://www.youtube.com/')).toBe('gone');
    expect(verdictFromResponse(404, null)).toBe('gone');
    expect(verdictFromResponse(410, null)).toBe('gone');
  });
  test('rate limits and server errors are unknown, never a verdict', () => {
    expect(verdictFromResponse(429, null)).toBe('unknown');
    expect(verdictFromResponse(503, null)).toBe('unknown');
  });
});
