// Plain-language status for a channel's history import, shown on /app/settings.
// Pure, so the wording is testable and lives in one place.

export interface StatusLike {
  status: 'queued' | 'running' | 'done' | 'failed';
  windows_total: number;
  windows_done: number;
  cursor_date: string | null;
  error?: string | null;
}

export interface StatusView {
  label: string;
  detail: string;
  tone: 'good' | 'bad' | 'accent' | 'muted';
  percent: number | null;
}

/** Whole percent of the history imported so far. */
export function progressPercent(j: StatusLike): number | null {
  if (!j.windows_total) return null;
  return Math.min(100, Math.round((j.windows_done / j.windows_total) * 100));
}

export function backfillStatus(j: StatusLike | null, lastSyncedAt?: string | null, now: Date = new Date()): StatusView {
  if (!j) {
    return lastSyncedAt
      ? { label: 'Synced', detail: `Last updated ${shortDate(lastSyncedAt, now)}.`, tone: 'good', percent: null }
      : { label: 'Connected', detail: 'History import has not started yet.', tone: 'muted', percent: null };
  }
  const pct = progressPercent(j);
  if (j.status === 'queued') {
    return { label: 'Waiting to import', detail: 'Your history is in the queue. This usually starts within a few minutes.', tone: 'accent', percent: pct };
  }
  if (j.status === 'running') {
    const through = j.cursor_date ? ` Imported through ${shortDate(j.cursor_date, now)}.` : '';
    return { label: 'Importing history', detail: `${pct ?? 0}% done.${through} You can leave this page.`, tone: 'accent', percent: pct };
  }
  if (j.status === 'failed') {
    return { label: 'Import stopped', detail: `${j.error || 'Something went wrong.'} We will try again tonight.`, tone: 'bad', percent: pct };
  }
  return {
    label: 'History imported',
    detail: lastSyncedAt ? `Updated daily. Last run ${shortDate(lastSyncedAt, now)}.` : 'Updated daily from now on.',
    tone: 'good', percent: 100,
  };
}

function shortDate(value: string, now: Date): string {
  const d = new Date(value);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
