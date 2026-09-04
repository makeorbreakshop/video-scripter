// How much of /app/channels is drawn at once.
//
// Every row carries an avatar, an inline SVG and two menus, so the list renders a page at a
// time and grows as the reader reaches the foot. That leaves the rest of the list behind a
// thing that has to actually happen — and an IntersectionObserver is not that thing: the
// observer on the foot was re-created on every parent render (its effect depended on a
// callback rebuilt each time), so it was torn down before it could ever deliver and the
// list sat at 60 rows with channels 61-500 unreachable.
//
// The arithmetic lives here so the foot can be a button, and the button's behaviour can be
// pinned without a browser.

/** One screenful and then some. */
export const CHANNEL_PAGE = 60;

/** One more page, never past the end of the list. */
export function nextLimit(current: number, total: number): number {
  const t = Math.max(0, total);
  return Math.min(t, Math.max(0, current) + CHANNEL_PAGE);
}

/** Is there anything below what is drawn? */
export function hasMore(total: number, limit: number): boolean {
  return total > limit;
}

/** What the foot says next to the button. */
export function moreLabel(drawn: number, total: number): string {
  return `${drawn} of ${total}`;
}
