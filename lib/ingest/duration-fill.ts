// The is_short decision for a duration-only backfill (scripts/fill-durations.ts), expressed
// through the one Shorts rule in ./classify.ts rather than a private regex.
//
// A backfill knows the duration and nothing else, so it can only settle the two ends of the
// range. Above 62s duration is not evidence: a 63-180s clip is decided by YouTube's own
// /shorts/<id> routing (lib/thumbs/shorts.ts), which the scheduled verifier
// (scripts/verify-shorts.ts) obtains. Returning null means "write nothing" — is_short keeps its
// current value and shorts_checked_at stays NULL, which longformSql treats as a Short until the
// verifier settles it. Never a guess, and never a freshness stamp for a check we did not do.
import { classifyItem } from './classify';

/** true = Short, false = long-form, null = leave videos.is_short / shorts_checked_at alone. */
export function isShortForFilledDuration(duration: string | null | undefined): boolean | null {
  const kind = classifyItem({ contentDetails: { duration: duration ?? null } });
  if (kind === 'short') return true;
  if (kind === 'longform') return false;
  return null; // 'clip' (63-180s, needs routing) or 'live' (placeholder/unparsable)
}
