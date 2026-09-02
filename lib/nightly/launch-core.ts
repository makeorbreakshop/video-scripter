// Pure scheduling logic for the launch-window tracker (no I/O).
// Log-spaced launch sampling (2026-09-02, see shared-memory analysis 2026-09-02-sampling-and-
// thumbnail-change-analysis section 5). The LaunchAgent ticks every 5 min; per-video due times
// live in track_schedule.next_check.
//
//   STANDARD tier   0-1h  : 5 min      DENSE tier   0-2h  : 5 min
//                   1-6h  : 15 min                  2-24h : 15 min
//                   6-24h : 30 min                  24-72h: 30 min ("baseline shadow" thru day 3)
//   then fixed checkpoints at days 2,3,5,7,14,30, then catalog rotation (daily/weekly).
//   RE-ENTRY on a detected packaging change (any tier): 5 min for 2h after the change, then
//   15 min until 24h after the change, then back to the video's normal schedule.
// Standard launch = ~68 samples (was 96 at a flat 15 min).
// Same egress rule as tracking-core: direct Postgres only, never Supabase REST.

export const RUN_INTERVAL_MIN = 5; // LaunchAgent tick; finest ladder step
export const LAUNCH_WINDOW_HOURS = 24;
export const CHANGE_WINDOW_HOURS = 24;
export const FIXED_DAYS = [2, 3, 5, 7, 14, 30];
export const CATALOG_LARGE_VIEWS = 100_000; // daily above this, weekly below
export const TITLE_CHECK_MIN = 60;

export type Tier = 'standard' | 'dense';

// Ladders are [ageBelowHours, intervalMinutes] rungs, ascending; past the last rung the
// phase ends and the fixed-day checkpoints take over.
export type Ladder = ReadonlyArray<readonly [number, number]>;

export const LAUNCH_LADDER: Record<Tier, Ladder> = {
  standard: [[1, 5], [6, 15], [24, 30]],
  dense: [[2, 5], [24, 15], [72, 30]],
};

// Applies from the moment a packaging change is detected, whatever the tier.
export const CHANGE_LADDER: Ladder = [[2, 5], [24, 15]];

export function ladderInterval(ladder: Ladder, hours: number): number | null {
  if (hours < 0) return null;
  for (const [below, interval] of ladder) if (hours < below) return interval;
  return null;
}

export type Phase = 'launch' | 'fixed' | 'catalog';

export interface ScheduleState {
  published_at: Date;
  // When the most recent packaging change (thumbnail version / title change) was detected.
  // null for videos that have never had one. Drives the re-entry burst.
  change_at?: Date | null;
  tier?: Tier;
  last_views: number | null;
}

export interface NextCheck {
  phase: Phase;
  next_check: Date;
}

const MS_MIN = 60_000;
const MS_DAY = 86_400_000;

export function launchUntilFor(publishedAt: Date): Date {
  return new Date(publishedAt.getTime() + LAUNCH_WINDOW_HOURS * 3_600_000);
}

// Given state after a sample taken at `now`, decide the next check.
// Pure function of (published_at, change_at, tier, now) — no wall-clock or I/O.
export function nextCheck(s: ScheduleState, now: Date): NextCheck {
  const hours = (t: Date) => (now.getTime() - t.getTime()) / 3_600_000;

  // 1. Re-entry burst after a detected packaging change overrides any sparser schedule.
  if (s.change_at) {
    const i = ladderInterval(CHANGE_LADDER, hours(s.change_at));
    if (i !== null) return { phase: 'launch', next_check: new Date(now.getTime() + i * MS_MIN) };
  }

  // 2. Normal log-spaced launch ladder for the tier.
  const launchInterval = ladderInterval(LAUNCH_LADDER[s.tier ?? 'standard'], hours(s.published_at));
  if (launchInterval !== null) {
    return { phase: 'launch', next_check: new Date(now.getTime() + launchInterval * MS_MIN) };
  }

  // 3. Fixed checkpoints, then catalog rotation.
  const ageDays = (now.getTime() - s.published_at.getTime()) / MS_DAY;
  for (const d of FIXED_DAYS) {
    if (ageDays < d) {
      return { phase: 'fixed', next_check: new Date(s.published_at.getTime() + d * MS_DAY) };
    }
  }
  const large = (s.last_views ?? 0) >= CATALOG_LARGE_VIEWS;
  return { phase: 'catalog', next_check: new Date(now.getTime() + (large ? 1 : 7) * MS_DAY) };
}

// A packaging change re-opens the launch window for 24h from now (5-min burst for the first
// 2h, then 15-min — see CHANGE_LADDER). launch_until stays the stored marker; the change time
// is recovered as launch_until - CHANGE_WINDOW_HOURS.
export function reenter(now: Date): { launch_until: Date; next_check: Date; phase: Phase } {
  return { launch_until: new Date(now.getTime() + CHANGE_WINDOW_HOURS * 3_600_000), next_check: now, phase: 'launch' };
}

// Recover the change time from a stored launch_until written by reenter().
export function changeAtFromLaunchUntil(launchUntil: Date | null): Date | null {
  return launchUntil ? new Date(launchUntil.getTime() - CHANGE_WINDOW_HOURS * 3_600_000) : null;
}

export function titleCheckDue(lastTitleCheck: Date | null, now: Date): boolean {
  return !lastTitleCheck || now.getTime() - lastTitleCheck.getTime() >= TITLE_CHECK_MIN * MS_MIN;
}

// Parse <entry> blocks of a channel RSS feed into id -> title (entities decoded).
export function parseRssTitles(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const id = /<yt:videoId>([A-Za-z0-9_-]{6,20})<\/yt:videoId>/.exec(m[1])?.[1];
    const t = /<title>([\s\S]*?)<\/title>/.exec(m[1])?.[1];
    if (id && t != null) out.set(id, decodeEntities(t.trim()));
  }
  return out;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));
}

export function daysSincePublished(publishedAt: Date, now: Date): number {
  return Math.floor((now.getTime() - publishedAt.getTime()) / MS_DAY);
}
