// Paging /app/channels. The list renders a page at a time (500 rows was 878 row nodes and
// 29-158 ms of React per search keystroke), so the rest of the list has to be reachable —
// and reachable by something more certain than an IntersectionObserver firing.
import { CHANNEL_PAGE, hasMore, moreLabel, nextLimit } from './channel-list-page';

describe('nextLimit', () => {
  it('adds a page', () => {
    expect(nextLimit(60, 500)).toBe(120);
  });

  it('stops at the total rather than running past it', () => {
    expect(nextLimit(480, 500)).toBe(500);
    expect(nextLimit(500, 500)).toBe(500);
    expect(nextLimit(600, 500)).toBe(500);
  });

  it('is a page when it starts from nothing', () => {
    expect(nextLimit(0, 500)).toBe(CHANNEL_PAGE);
  });

  it('handles an empty list without going negative', () => {
    expect(nextLimit(60, 0)).toBe(0);
  });
});

describe('hasMore', () => {
  it('is true while the list has rows the window is not drawing', () => {
    expect(hasMore(500, 60)).toBe(true);
  });

  it('is false once the window covers everything', () => {
    expect(hasMore(60, 60)).toBe(false);
    expect(hasMore(12, 60)).toBe(false);
    expect(hasMore(0, 60)).toBe(false);
  });
});

describe('moreLabel', () => {
  // The count is the affordance: a foot that says nothing is a foot a reader cannot tell
  // is a foot. This is what the button announces next to it.
  it('says how much of the list is drawn', () => {
    expect(moreLabel(60, 500)).toBe('60 of 500');
    expect(moreLabel(120, 500)).toBe('120 of 500');
  });
});
