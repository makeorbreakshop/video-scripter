// The four badge states, and how to read a result's channel identity from the
// DOM (URL-level only — handles and UC ids out of hrefs, never page scraping).
import { HOSTS } from './badge-targets';

export type VideoStatus = 'tracked' | 'queued' | 'captured' | null;

export interface BadgeSpec {
  cls: string;
  text: string;
}

// channelKnown: true = channel in a registry, false = confirmed unknown,
// null = we couldn't determine (no channel link found / lookup pending).
export function classifyBadge(video: VideoStatus, channelKnown: boolean | null): BadgeSpec | null {
  if (video === 'tracked') return { cls: 'ci-tracked', text: '✓ tracked' };
  if (video === 'queued') return { cls: 'ci-queued', text: '⏳ queued' };
  if (video === 'captured') {
    return channelKnown === false
      ? { cls: 'ci-newchannel', text: '★ new channel' }
      : { cls: 'ci-captured', text: '◉ new → queued' };
  }
  return null;
}

export function normalizeChannelRef(ref: string): string {
  return ref.replace(/^@/, '').toLowerCase();
}

export function channelRefFromAnchor(a: Element): string | null {
  const host = a.closest(HOSTS) || a.parentElement;
  if (!host) return null;
  for (const link of host.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') || '';
    const uc = href.match(/\/channel\/(UC[A-Za-z0-9_-]{22})/);
    if (uc) return uc[1];
    const h = href.match(/\/(@[A-Za-z0-9._-]{3,60})(?:[/?#]|$)/);
    if (h) return h[1];
  }
  return null;
}
