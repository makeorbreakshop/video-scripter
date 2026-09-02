// Pure parsing for "add a channel" input. Anything a user might paste into the
// add-channel box becomes a ChannelRef that lib/app/channels.ts knows how to
// resolve. No network, no database — all the guesswork lives here so it can be
// tested exhaustively.

export type ChannelRefKind = 'id' | 'handle' | 'video' | 'search';

export interface ChannelRef {
  kind: ChannelRefKind;
  /** id: UC…  handle: @name (leading @ kept)  video: 11-char video id  search: raw text */
  value: string;
}

/** YouTube channel ids are always UC + 22 url-safe base64 chars. */
export const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;
/** Video ids are 11 url-safe base64 chars. */
export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
/** Handles: 3-30 chars of letters, digits, dot, dash, underscore. */
export const HANDLE_RE = /^[A-Za-z0-9._-]{3,30}$/;

const YT_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtu.be', 'www.youtu.be',
]);

function search(value: string): ChannelRef {
  return { kind: 'search', value };
}

function parseUrl(raw: string): URL | null {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    return YT_HOSTS.has(u.hostname.toLowerCase()) ? u : null;
  } catch {
    return null;
  }
}

/**
 * Parse any add-channel input into a reference.
 *  - youtube.com/channel/UC…            -> id
 *  - youtube.com/@handle, bare @handle  -> handle
 *  - youtube.com/c/name, /user/name     -> handle (channels.list forHandle
 *                                          resolves most legacy vanity names;
 *                                          a miss falls back to search)
 *  - watch?v=, youtu.be/, /shorts/, /live/, /embed/  -> video (needs a lookup)
 *  - bare UC… id                        -> id
 *  - anything else                      -> search
 */
export function parseChannelInput(input: string): ChannelRef {
  const raw = (input || '').trim();
  if (!raw) return search('');

  const url = parseUrl(raw);
  if (url) {
    const segs = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    // youtu.be/<videoId>
    if (url.hostname.toLowerCase().endsWith('youtu.be')) {
      const id = segs[0] || '';
      return VIDEO_ID_RE.test(id) ? { kind: 'video', value: id } : search(raw);
    }

    const v = url.searchParams.get('v');
    if (v && VIDEO_ID_RE.test(v)) return { kind: 'video', value: v };

    const [first, second] = segs;
    if (!first) return search(raw);

    if (first.startsWith('@')) {
      const h = first.slice(1);
      return HANDLE_RE.test(h) ? { kind: 'handle', value: `@${h}` } : search(raw);
    }
    if (first === 'channel' && second) {
      return CHANNEL_ID_RE.test(second) ? { kind: 'id', value: second } : search(raw);
    }
    if ((first === 'c' || first === 'user') && second) {
      return HANDLE_RE.test(second) ? { kind: 'handle', value: `@${second}` } : search(raw);
    }
    if ((first === 'shorts' || first === 'live' || first === 'embed' || first === 'watch') && second) {
      return VIDEO_ID_RE.test(second) ? { kind: 'video', value: second } : search(raw);
    }
    return search(raw);
  }

  // Bare forms.
  if (CHANNEL_ID_RE.test(raw)) return { kind: 'id', value: raw };
  if (raw.startsWith('@')) {
    const h = raw.slice(1);
    return HANDLE_RE.test(h) ? { kind: 'handle', value: `@${h}` } : search(raw);
  }
  return search(raw);
}

/** The handle without its '@', for the YouTube API's forHandle parameter. */
export function bareHandle(value: string): string {
  return value.startsWith('@') ? value.slice(1) : value;
}

/** Uploads playlist for a channel: UC… -> UU…  (the one free id transform). */
export function uploadsPlaylistId(channelId: string): string {
  if (!CHANNEL_ID_RE.test(channelId)) throw new Error(`not a channel id: ${channelId}`);
  return 'UU' + channelId.slice(2);
}
