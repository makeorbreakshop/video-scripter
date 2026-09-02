// Pure scheduling logic for the launch-window tracker (no I/O).
// Schedule: every run (15 min) while inside the launch window (first 24h after publish,
// or 24h after a detected thumbnail/title change), then one sample at days 2,3,5,7,14,30
// after publish, then catalog cadence (daily if large, weekly otherwise).
// Same egress rule as tracking-core: direct Postgres only, never Supabase REST.

export const RUN_INTERVAL_MIN = 15;
export const LAUNCH_WINDOW_HOURS = 24;
export const FIXED_DAYS = [2, 3, 5, 7, 14, 30];
export const CATALOG_LARGE_VIEWS = 100_000; // daily above this, weekly below
export const TITLE_CHECK_MIN = 60;

export type Phase = 'launch' | 'fixed' | 'catalog';

export interface ScheduleState {
  published_at: Date;
  launch_until: Date | null;
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
export function nextCheck(s: ScheduleState, now: Date): NextCheck {
  if (s.launch_until && now < s.launch_until) {
    return { phase: 'launch', next_check: new Date(now.getTime() + RUN_INTERVAL_MIN * MS_MIN) };
  }
  const ageDays = (now.getTime() - s.published_at.getTime()) / MS_DAY;
  for (const d of FIXED_DAYS) {
    if (ageDays < d) {
      return { phase: 'fixed', next_check: new Date(s.published_at.getTime() + d * MS_DAY) };
    }
  }
  const large = (s.last_views ?? 0) >= CATALOG_LARGE_VIEWS;
  return { phase: 'catalog', next_check: new Date(now.getTime() + (large ? 1 : 7) * MS_DAY) };
}

// A packaging change re-opens the launch window for 24h from now.
export function reenter(now: Date): { launch_until: Date; next_check: Date; phase: Phase } {
  return { launch_until: new Date(now.getTime() + LAUNCH_WINDOW_HOURS * 3_600_000), next_check: now, phase: 'launch' };
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
