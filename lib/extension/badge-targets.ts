// Pure DOM logic for the Chrome extension's tracked-badge painter.
// Given a root, find every video result and the element the badge should attach to.
// Kept framework-free so it can be unit-tested and bundled into content.js.

export interface BadgeTarget {
  id: string;
  container: Element;
}

export function videoIdFromHref(href: string): string | null {
  const m = href.match(/[?&]v=([A-Za-z0-9_-]{6,20})/);
  return m ? m[1] : null;
}

// Result containers across YouTube's markup generations. The lockup variants
// (2025+) separate the /watch anchor from the thumbnail img, so the img must be
// found from the shared host, not from inside the anchor.
export const HOSTS =
  'yt-lockup-view-model, ytd-video-renderer, ytd-rich-grid-media, ytd-compact-video-renderer, ytd-rich-item-renderer, ytd-grid-video-renderer';

// When no targets are found on a page that clearly has watch links, describe
// the first anchor's real surroundings so the unknown markup can become a
// test fixture instead of a guess.
export function markupFingerprint(root: ParentNode): string | null {
  const a = root.querySelector('a[href*="/watch?v="]');
  if (!a) return 'no watch anchors';
  const chain: string[] = [];
  let el: Element | null = a;
  for (let i = 0; i < 8 && el; i++) {
    chain.push(el.tagName.toLowerCase());
    el = el.parentElement;
  }
  const host = a.closest(HOSTS);
  const doc = (root as Document).documentElement ? (root as Document) : null;
  return [
    `chain ${chain.join('>')}`,
    `anchorImg ${!!a.querySelector('img')}`,
    `host ${host ? host.tagName.toLowerCase() : 'none'}`,
    `hostImg ${!!host?.querySelector('img')}`,
    `pageImgs ${doc ? doc.images.length : '?'}`,
  ].join(' · ');
}

export function findBadgeTargets(root: ParentNode): BadgeTarget[] {
  const out: BadgeTarget[] = [];
  const seen = new Set<string>();
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href*="/watch?v="]')) {
    const id = videoIdFromHref(a.getAttribute('href') || '');
    if (!id || seen.has(id)) continue;
    const host = a.closest(HOSTS);
    const img = a.querySelector('img') ?? host?.querySelector('img') ?? null;
    if (!img) continue;
    seen.add(id);
    out.push({ id, container: img.parentElement || a });
  }
  return out;
}
