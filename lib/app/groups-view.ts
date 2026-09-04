// Pure logic for channel groups, the notify meter, the sparkline lane and the import sheet.
// No network, no database, no React — so every rule the /app/channels page runs on is
// testable on its own (lib/app/groups-view.test.ts).

// ------------------------------------------------------------------ colours --

/**
 * The eight group colours. Only the KEY is stored; the hex lives in app/app/theme.css as
 * --cs-g-<key>, so a group looks right on both grounds and a theme change moves it.
 */
export const GROUP_COLORS = [
  'green', 'amber', 'teal', 'red', 'violet', 'blue', 'brown', 'slate',
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export function isGroupColor(v: unknown): v is GroupColor {
  return typeof v === 'string' && (GROUP_COLORS as readonly string[]).includes(v);
}

/** The CSS variable a colour key resolves to. */
export function groupColorVar(color: string | null | undefined): string {
  return `var(--cs-g-${isGroupColor(color) ? color : 'slate'})`;
}

/**
 * Round-robin: the nth group a user creates gets the nth colour. Taking the count rather
 * than the used set means deleting a group does not make the next one repeat the colour
 * beside it — position in the sequence is what decides.
 */
export function nextGroupColor(existingCount: number): GroupColor {
  const n = Number.isFinite(existingCount) && existingCount > 0 ? Math.floor(existingCount) : 0;
  return GROUP_COLORS[n % GROUP_COLORS.length];
}

/** A group name a user typed, or null when it is not usable. */
export const MAX_GROUP_NAME = 40;
export function normalizeGroupName(raw: string | null | undefined): string | null {
  const name = (raw || '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  return name.slice(0, MAX_GROUP_NAME);
}

// ------------------------------------------------------------------- groups --

export interface GroupLike {
  id: string;
  name: string;
  color: string;
  position: number;
}

export interface GroupedRowLike {
  channel_id: string;
  /** Group ids this channel belongs to. */
  groups?: string[] | null;
}

/** Rows in the chosen group. `null` / 'all' is every row. */
export function filterByGroup<T extends GroupedRowLike>(rows: T[], groupId: string | null): T[] {
  if (!groupId || groupId === 'all') return rows || [];
  return (rows || []).filter((r) => (r.groups || []).includes(groupId));
}

/** How many of the user's channels sit in each group, plus the All count. */
export function groupCounts(rows: GroupedRowLike[], groups: GroupLike[]): Record<string, number> {
  const out: Record<string, number> = { all: (rows || []).length };
  for (const g of groups || []) out[g.id] = 0;
  for (const r of rows || []) for (const id of r.groups || []) if (id in out) out[id] += 1;
  return out;
}

export type TriState = 'on' | 'off' | 'mixed';

/**
 * The state of one group's checkbox in the add-to-group popover, over the selected channels:
 * every one of them is in the group, none is, or some are. An empty selection is 'off' —
 * there is nothing to be mixed about.
 */
export function triState(selected: GroupedRowLike[], groupId: string): TriState {
  const rows = selected || [];
  if (!rows.length) return 'off';
  let inGroup = 0;
  for (const r of rows) if ((r.groups || []).includes(groupId)) inGroup += 1;
  if (inGroup === 0) return 'off';
  return inGroup === rows.length ? 'on' : 'mixed';
}

/** Clicking a tri-state checkbox: anything short of "all in" adds; "all in" removes. */
export function triStateAction(state: TriState): 'add' | 'remove' {
  return state === 'on' ? 'remove' : 'add';
}

// --------------------------------------------------------------- sparklines --

export interface SparkPoint { t: number; v: number }

/**
 * Downsample a series to at most `max` points by picking evenly spaced samples, always
 * keeping the first and the last — the percent change is read off those two, so they must
 * survive. Fewer points than the cap pass through untouched.
 */
export const SPARK_MAX_POINTS = 24;

export function downsample<T>(points: T[], max = SPARK_MAX_POINTS): T[] {
  const p = points || [];
  if (max < 2) return p.length ? [p[p.length - 1]] : [];
  if (p.length <= max) return [...p];
  const out: T[] = [];
  const step = (p.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(p[Math.round(i * step)]);
  return out;
}

/** Last against first, as a percentage. Null when there is nothing to compare. */
export function percentChange(points: SparkPoint[]): number | null {
  const p = points || [];
  if (p.length < 2) return null;
  const first = p[0]?.v;
  const last = p[p.length - 1]?.v;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  return Math.round(((last - first) / first) * 100);
}

/** "+38%" / "-12%" / "" — the row's second number. */
export function percentLabel(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '';
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/**
 * The polyline for a sparkline lane, normalised into a `w × h` box. A flat series (or one
 * point) sits on the middle line rather than dividing by zero.
 */
export function sparkPath(points: SparkPoint[], w = 120, h = 28, pad = 3): string {
  const p = points || [];
  if (!p.length) return '';
  if (p.length === 1) return `0,${h / 2} ${w},${h / 2}`;
  const vs = p.map((q) => q.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min;
  const inner = h - pad * 2;
  return p
    .map((q, i) => {
      const x = (i / (p.length - 1)) * w;
      const y = span === 0 ? h / 2 : pad + inner - ((q.v - min) / span) * inner;
      return `${round(x)},${round(y)}`;
    })
    .join(' ');
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// ------------------------------------------------------------------- notify --

export interface NotifyGate {
  count: number;
  limit: number;
  unlimited: boolean;
  atLimit: boolean;
  /** "NOTIFYING 8/25" — the pixel-font label over the meter. */
  label: string;
  /** How many segments the meter draws. Only meaningful when `bar` is true. */
  segments: number;
  /** Whether to draw the meter at all — only a capped plan has something to measure. */
  bar: boolean;
}

/**
 * The notify meter. The limit is the plan's tracked-channel limit, repurposed: tracking is
 * no longer capped, so that number now says how many channels a plan may be notified about.
 */
export const NOTIFY_METER_MAX = 40;

export function notifyGate(count: number, limit: number): NotifyGate {
  const n = Math.max(0, Math.floor(count || 0));
  const unlimited = !Number.isFinite(limit);
  const cap = unlimited ? n : Math.max(0, Math.floor(limit));
  return {
    count: n,
    limit: cap,
    unlimited,
    atLimit: !unlimited && n >= cap,
    label: unlimited ? `NOTIFYING ${n}` : `NOTIFYING ${n}/${cap}`,
    segments: Math.max(1, Math.min(NOTIFY_METER_MAX, unlimited ? Math.max(n, 1) : cap)),
    bar: !unlimited,
  };
}

/**
 * Can these channels be switched on? `adding` is how many are currently off among the
 * selection. Refuses the whole batch rather than half-applying it.
 */
export function canNotifyMore(count: number, limit: number, adding: number): { ok: boolean; reason?: string } {
  if (!Number.isFinite(limit)) return { ok: true };
  const room = Math.max(0, Math.floor(limit) - Math.max(0, count));
  if (adding <= room) return { ok: true };
  return {
    ok: false,
    reason: room === 0
      ? `You are notifying about all ${Math.floor(limit)} channels your plan allows. Mute one first.`
      : `Your plan notifies about ${Math.floor(limit)} channels — room for ${room} more.`,
  };
}

// ------------------------------------------------------------------- import --

export interface SubscriptionLike {
  channel_id: string;
  name: string;
  avatar_url?: string | null;
  subscriber_count?: number | string | null;
  tracked: boolean;
}

/** Already-tracked subscriptions start unchecked; everything else starts checked. */
export function importDefaults(subs: SubscriptionLike[]): Set<string> {
  return new Set((subs || []).filter((s) => !s.tracked).map((s) => s.channel_id));
}

/** The import sheet shows five, then "+ N MORE". */
export const IMPORT_VISIBLE = 5;

export function importVisible<T>(subs: T[], expanded: boolean, visible = IMPORT_VISIBLE): { shown: T[]; more: number } {
  const all = subs || [];
  if (expanded || all.length <= visible) return { shown: all, more: 0 };
  return { shown: all.slice(0, visible), more: all.length - visible };
}

/** The primary button's words. Nothing selected disables it. */
export function importButtonLabel(n: number): string {
  return n === 1 ? 'Track 1 channel' : `Track ${n} channels`;
}

// ---------------------------------------------------------------- recency --

/**
 * How long ago the channel last published, as the row's subline. Videos and subscribers are
 * facts that change on no timescale this page cares about; when the last video landed is the
 * one that decides whether you click the row.
 */
export function recencyLabel(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const days = Math.floor((now - t) / 86_400_000);
  if (days < 0) return 'today';
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  if (days < 730) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Which way the sparkline is going. Colour is never the only carrier — the shape says it too. */
export function sparkDirection(pct: number | null | undefined): 'up' | 'down' | 'flat' {
  if (pct == null || !Number.isFinite(pct)) return 'flat';
  if (pct > 0.5) return 'up';
  if (pct < -0.5) return 'down';
  return 'flat';
}
