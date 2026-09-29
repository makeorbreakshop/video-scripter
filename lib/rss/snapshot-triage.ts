// The poller's snapshot phase, triaged in the database first.
//
// scripts/rss-poll.ts used to read five rows per feed video id every tick — the title and its
// watch stamp, the newest description sha, the newest title and thumbnail versions, and the last
// reading — ~253 B per id, 38,741 ids on a full tick: ~9.8 MB per tick (measured 2026-09-29), for
// entries where, most ticks, nothing had changed. Now the tick SENDS what the feed says (ingress
// is not billed) and Postgres answers with a bitmask per entry, returning a row only for an entry
// that is unknown or where something may have changed. Only those ids take the old full read.
//
// Every flag is exact or a SUPERSET of the JS condition it stands for, and the JS still makes
// the exact decision on the full rows it reads for flagged ids. A quiet entry is one where every
// JS branch was already a no-op: known, title equal, newest description sha equal (or no feed
// description), thumbnail not updated since last checked, reading neither changed nor due for its
// heartbeat. lib/rss/snapshot-triage.integration.test.ts proves the parity on a real tick.
import type { RssEntry } from './poll-policy';

export const TRIAGE = { KNOWN: 1, TITLE: 2, DESC: 4, THUMB: 8, SAMPLE: 16 } as const;

/**
 * $1 ids, $2 feed titles, $3 feed description sha256 (null when the feed carries none),
 * $4 feed views, $5 feed <updated>, $6 when the feed was fetched, $7 SAMPLE_HEARTBEAT_MS.
 * One row per id that is NOT (known and quiet). last_views/last_at only when SAMPLE is set.
 */
export const SNAPSHOT_TRIAGE_SQL = `
  /* trace:rss.snapshot-triage */
  with f as (
    select * from unnest($1::text[], $2::text[], $3::text[], $4::bigint[], $5::timestamptz[], $6::timestamptz[])
      as f(id, title, desc_sha, views, updated, observed_at)
  ), m as (
    select f.id, bit_or(
        (case when v.id is not null then 1 else 0 end)
      | (case when v.id is not null and coalesce(f.title, '') <> '' and coalesce(v.title, '') <> ''
                    and v.title <> f.title then 2 else 0 end)
      | (case when v.id is not null and f.desc_sha is not null
                    and (d.sha256 is null or d.sha256 <> f.desc_sha) then 4 else 0 end)
      | (case when v.id is not null and t.last_checked > 'epoch'::timestamptz and f.updated is not null
                    and f.updated > t.last_checked - interval '1 millisecond' then 8 else 0 end)
      | (case when f.views is not null and (l.video_id is null or l.views is null or l.views <> f.views
                    or f.observed_at - l.at >= ($7::bigint - 1) * interval '1 millisecond') then 16 else 0 end)
      ) as mask
      from f
      left join videos v on v.id = f.id
      left join lateral (select dv.sha256 from description_versions dv
                          where v.id is not null and dv.video_id = f.id order by dv.version desc limit 1) d on true
      left join lateral (select tv.last_checked from thumbnail_versions tv
                          where v.id is not null and tv.video_id = f.id order by tv.version desc limit 1) t on true
      left join rss_latest l on l.video_id = f.id
     group by f.id
  )
  select m.id, m.mask,
         case when m.mask & 16 <> 0 then l.views end as last_views,
         case when m.mask & 16 <> 0 then l.at end as last_at
    from m left join rss_latest l on l.video_id = m.id
   where m.mask <> 1`;

export interface TriageEntry { entry: RssEntry; observedAt: Date }

/** Query parameters for one chunk of entries. `descSha` must be the poller's own hash. */
export function triageParams(items: readonly TriageEntry[], descSha: (s: string) => string, heartbeatMs: number): unknown[] {
  const iso = (s: string | null) => {
    if (!s) return null;
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null; // NaN in JS = never "updated since"
  };
  const views = (v: number | null) => (v != null && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
  return [
    items.map((i) => i.entry.video_id),
    items.map((i) => i.entry.title ?? null),
    items.map((i) => (i.entry.description != null ? descSha(i.entry.description) : null)),
    items.map((i) => views(i.entry.views)),
    items.map((i) => iso(i.entry.updated)),
    items.map((i) => i.observedAt.toISOString()),
    heartbeatMs,
  ];
}

export class Triage {
  /** id -> mask for every id the database returned; an id absent here is known and quiet. */
  readonly masks = new Map<string, number>();
  readonly lastSamples = new Map<string, { views: number | null; at: Date }>();

  add(rows: readonly { id: string; mask: number | string; last_views?: unknown; last_at?: unknown }[]): void {
    for (const r of rows) {
      const mask = Number(r.mask);
      this.masks.set(r.id, (this.masks.get(r.id) ?? 0) | mask);
      if (mask & TRIAGE.SAMPLE && r.last_at != null) {
        this.lastSamples.set(r.id, { views: r.last_views == null ? null : Number(r.last_views), at: new Date(r.last_at as any) });
      }
    }
  }

  known(id: string): boolean { const m = this.masks.get(id); return m === undefined || (m & TRIAGE.KNOWN) !== 0; }
  /** False means the JS sample decision is certainly "skip". */
  sampleMayStore(id: string): boolean { return ((this.masks.get(id) ?? 0) & TRIAGE.SAMPLE) !== 0; }
  /** Known ids whose title, description or thumbnail may have changed: they take the full read. */
  fullReadIds(): string[] {
    const changed = TRIAGE.TITLE | TRIAGE.DESC | TRIAGE.THUMB;
    return [...this.masks].filter(([, m]) => (m & TRIAGE.KNOWN) && (m & changed)).map(([id]) => id);
  }
  /** Known ids that skip the full read: every title/description/thumbnail branch is a no-op. */
  quietKnownIds(allIds: readonly string[]): string[] {
    const full = new Set(this.fullReadIds());
    return allIds.filter((id) => this.known(id) && !full.has(id));
  }
}
