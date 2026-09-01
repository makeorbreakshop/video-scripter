// Human-readable hint for a captured video: the title, never thumbnail
// chrome (duration overlays, "Now playing", live badges, our own ci-badges).

const NOISE = /^(\s*(\d+:)?\d+:\d+\s*)+/; // leading duration stamps like "7:29 7:29"
const PURE_NOISE = /^\s*((\d+:)?\d+:\d+|now playing|live|shorts|new)?\s*$/i;

export function cleanHint(raw: string): string {
  const t = raw
    .replace(/[✓◉⏳]\s*(tracked|captured|importing)/gi, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return PURE_NOISE.test(t) ? '' : t.slice(0, 80);
}

export function hintForAnchor(a: Element): string {
  // 1. The anchor's own accessible name, if it's a real title.
  const own = cleanHint(a.getAttribute('title') || a.getAttribute('aria-label') || '');
  if (own) return own;
  // 2. The result's title element, from the shared host container.
  const host = a.closest(
    'yt-lockup-view-model, ytd-video-renderer, ytd-rich-grid-media, ytd-compact-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer'
  );
  const titleEl = host?.querySelector(
    '#video-title, .yt-lockup-metadata-view-model-wiz__title, a[title]'
  );
  const fromTitle = cleanHint(
    titleEl?.getAttribute('title') || titleEl?.textContent || ''
  );
  if (fromTitle) return fromTitle;
  // 3. Last resort: the anchor's text with chrome stripped; may be ''.
  return cleanHint(a.textContent || '');
}
