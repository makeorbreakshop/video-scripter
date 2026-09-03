// The one Shorts/live rule for every path that INSERTS into `videos`.
//
// Five ingest paths used to each carry their own copy of "duration <= 62s => Short => skip".
// That was YouTube's original Shorts ceiling; Shorts have run up to 180s since late 2024, so
// 63-180s Shorts were inserted as long-form with is_short=false and never verified — 64K such
// rows polluted channel baselines (see lib/scoring/longform.ts).
//
// Duration alone cannot separate a 2-minute Short from a 2-minute trailer, so a 63-180s upload
// is a 'clip': it must be settled against YouTube's own routing (lib/thumbs/shorts.ts, zero API
// quota) before it counts as long-form. A clip we could not reach is still inserted, but with
// shorts_checked_at NULL, which longformSql treats as a Short until the scheduled verifier
// (scripts/verify-shorts.ts) settles it.
import { durationSeconds, SHORT_MAX_SECONDS } from '../scoring/longform';
import { isShortByRedirect } from '../thumbs/shorts';

/** Classic Shorts ceiling: at or under this, it is a Short with no need to ask YouTube. */
export const CLASSIC_SHORT_MAX_SECONDS = 62;

export type ItemKind = 'live' | 'short' | 'clip' | 'longform';

export interface ClassifiableItem {
  id?: string;
  snippet?: { liveBroadcastContent?: string | null } | null;
  contentDetails?: { duration?: string | null } | null;
}

/**
 * Duration/liveBroadcastContent -> kind, for a YouTube Data API `videos.list` item.
 *   'live'     — a live or upcoming broadcast, or a placeholder/unparsable duration
 *   'short'    — <= 62s: always a Short, never inserted
 *   'clip'     — 63..180s: MUST be verified before it counts as long-form
 *   'longform' — > 180s
 */
export function classifyItem(item: ClassifiableItem): ItemKind {
  const bc = item?.snippet?.liveBroadcastContent;
  if (bc === 'live' || bc === 'upcoming') return 'live';
  const secs = durationSeconds(item?.contentDetails?.duration);
  // 'P0D', missing, unparsable, or a zero-length duration ('PT'): a placeholder, not a show.
  if (secs == null || secs <= 0) return 'live';
  if (secs <= CLASSIC_SHORT_MAX_SECONDS) return 'short';
  if (secs <= SHORT_MAX_SECONDS) return 'clip';
  return 'longform';
}

export interface InsertClassification {
  kind: ItemKind;
  /** Value for videos.is_short; null only for 'live' rows, which are not inserted. */
  is_short: boolean | null;
  /** 'now' => write now(); null => leave NULL (unverified). */
  shorts_checked_at: 'now' | null;
}

/**
 * Same rule, with a 'clip' settled by one zero-quota question to YouTube.
 * `ask` is injectable so unit tests never touch the network.
 */
export async function classifyForInsert(
  item: ClassifiableItem,
  ask: (videoId: string) => Promise<boolean | null> = isShortByRedirect
): Promise<InsertClassification> {
  const kind = classifyItem(item);
  if (kind === 'live') return { kind, is_short: null, shorts_checked_at: null };
  if (kind === 'short') return { kind, is_short: true, shorts_checked_at: null };
  if (kind === 'longform') return { kind, is_short: false, shorts_checked_at: null };

  const verdict = await ask(String(item?.id ?? ''));
  if (verdict === true) return { kind: 'short', is_short: true, shorts_checked_at: 'now' };
  if (verdict === false) return { kind: 'longform', is_short: false, shorts_checked_at: 'now' };
  return { kind: 'clip', is_short: false, shorts_checked_at: null };
}

/** True for kinds that must not be inserted into the long-form corpus. */
export function skipForInsert(kind: ItemKind): boolean {
  return kind === 'live' || kind === 'short';
}
