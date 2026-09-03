// rss_samples retention. Pure decision logic + its SQL; the runner is scripts/rss-retention.ts.
//
// The dense trace only earns its disk while it is dense. Past the window below, 96 readings of
// a day tell you nothing that the last one of that day does not, so the tail is thinned to one
// row per video per day. Direct Postgres only (2026-08-31 egress rule).

export const RSS_RETENTION = {
  /** Readings younger than this keep full 15-minute resolution. */
  denseWindowDays: 30,
  /** Rows deleted per statement, so one pass never takes a huge lock. */
  batchSize: 50_000,
} as const;

export interface SampleRow {
  id?: number | string;
  video_id: string;
  at: Date | string;
}

function newer(a: SampleRow, b: SampleRow): boolean {
  const at = new Date(a.at).getTime(), bt = new Date(b.at).getTime();
  if (at !== bt) return at > bt;
  return String(a.id ?? '') > String(b.id ?? '');
}

/**
 * Which rows survive a thinning pass: everything inside the dense window, plus the LAST
 * reading of each (video, UTC day) outside it. Ties on `at` break on id, so the choice is
 * deterministic and matches the SQL's `order by at desc, ctid desc`.
 */
export function survivingSamples<T extends SampleRow>(
  rows: T[],
  now: Date = new Date(),
  denseWindowDays: number = RSS_RETENTION.denseWindowDays
): T[] {
  const cutoff = now.getTime() - denseWindowDays * 86_400_000;
  const keep = new Set<T>();
  const lastOfDay = new Map<string, T>();
  for (const r of rows) {
    const t = new Date(r.at).getTime();
    if (!Number.isFinite(t)) { keep.add(r); continue; } // never delete what we cannot date
    if (t >= cutoff) { keep.add(r); continue; }
    const day = new Date(r.at).toISOString().slice(0, 10);
    const k = `${r.video_id} ${day}`;
    const cur = lastOfDay.get(k);
    if (!cur || newer(r, cur)) lastOfDay.set(k, r);
  }
  for (const r of lastOfDay.values()) keep.add(r);
  return rows.filter((r) => keep.has(r));
}

/** The rows a pass deletes — the complement of survivingSamples. */
export function doomedSamples<T extends SampleRow>(
  rows: T[],
  now: Date = new Date(),
  denseWindowDays: number = RSS_RETENTION.denseWindowDays
): T[] {
  const survivors = new Set(survivingSamples(rows, now, denseWindowDays));
  return rows.filter((r) => !survivors.has(r));
}

/**
 * One thinning batch. Keeps the last reading of each (video_id, UTC day) older than the dense
 * window and deletes the rest — the same rule as survivingSamples, expressed set-based so the
 * whole pass is a handful of statements rather than a row-by-row walk.
 * $1 = dense window days, $2 = batch size.
 */
export const THIN_BATCH_SQL = `
  with doomed as (
    select ctid from (
      select ctid,
             row_number() over (
               partition by video_id, (at at time zone 'UTC')::date
               order by at desc, ctid desc
             ) as rn
        from rss_samples
       where at < now() - ($1 || ' days')::interval
    ) x
    where rn > 1
    limit $2
  )
  delete from rss_samples s using doomed d where s.ctid = d.ctid`;

export const COUNT_OLD_SQL = `select count(*)::bigint as n from rss_samples where at < now() - ($1 || ' days')::interval`;
