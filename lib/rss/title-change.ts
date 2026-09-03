// The one place a detected title difference is written, shared by every free-lane detector:
// scripts/rss-poll.ts (channel RSS, a channel's last 15 uploads) and scripts/thumbnail-watch.ts
// (oEmbed, the 14-90 day videos that have fallen out of the RSS window). Keeping it in one
// module is what stops the detectors from drifting.
//
// CHANGE vs SYNC (2026-09-03, after the first full-corpus pass emitted 708 title_change events,
// 329 of them on videos older than six months). A difference between the live title and the one
// we hold is only NEWS if we have recent evidence of the old title. Otherwise the title drifted
// at some unknown point while nobody was looking, and reporting it as "changed today" is a lie
// that also burns stats quota on a pointless dense re-entry.
//
// The evidence has to be recorded on purpose. videos.updated_at does not work: it is bumped by
// duration refreshes in the drainer and by the title write itself. track_schedule.last_title_check
// only ever covered videos under 30 days old. So videos.title_observed_at is a dedicated column
// that EVERY detector bumps on EVERY observation, changed or not.
import type pg from 'pg';
import { reenter } from '../nightly/launch-core';
import { revalidateRemote } from '../app/revalidate-remote';

/** How recent our evidence of the old title must be for a difference to count as news. */
export const TITLE_EVIDENCE_WINDOW_DAYS = 7;

export type TitleDiffKind = 'change' | 'sync';

export interface TitleDiffEvidence {
  /** When the video was published. Inside the window we have watched it since launch. */
  publishedAt: Date | string | null | undefined;
  /** When any detector last observed this video's title (videos.title_observed_at). */
  titleObservedAt: Date | string | null | undefined;
}

/**
 * 'change' = real news: a feed event and a stats-lane re-entry.
 * 'sync'   = a first observation or a drift we cannot date: update the title and archive the
 *            version with backfill = true, but emit nothing and re-enter nothing.
 */
export function classifyTitleDiff(e: TitleDiffEvidence, now: Date = new Date()): TitleDiffKind {
  const cutoff = now.getTime() - TITLE_EVIDENCE_WINDOW_DAYS * 86_400_000;
  // A video published inside the window has been under the watcher since it went live, so the
  // title we hold is the one we saw at launch — a difference now is a real edit.
  if (e.publishedAt && new Date(e.publishedAt).getTime() >= cutoff) return 'change';
  // Otherwise we need to have actually looked at the title recently.
  if (e.titleObservedAt && new Date(e.titleObservedAt).getTime() >= cutoff) return 'change';
  return 'sync';
}

export interface TitleVersionPlan {
  /** Archive the title we currently hold as version 1 first? Only when there is no history. */
  seedVersion1: boolean;
  /** Version number the newly observed title gets. */
  newVersion: number;
}

/**
 * title_versions starts empty for most videos: the title we already have in `videos` was never
 * archived. The first difference therefore writes TWO rows — v1 (the old title, stamped at
 * publish time) and v2 (the new one) — so a feed event has an old title to show. Later
 * differences just append.
 */
export function titleVersionPlan(maxVersion: number): TitleVersionPlan {
  return maxVersion === 0
    ? { seedVersion1: true, newVersion: 2 }
    : { seedVersion1: false, newVersion: maxVersion + 1 };
}

/**
 * Bump the observation stamp for titles we looked at and found unchanged. Every detector must
 * call this on every poll, or the evidence window silently empties and real changes start being
 * classified as syncs.
 */
export async function recordTitleObservations(
  pool: pg.Pool,
  videoIds: string[],
  now: Date
): Promise<void> {
  if (!videoIds.length) return;
  await pool.query(`update videos set title_observed_at = $2 where id = any($1)`, [videoIds, now]);
}

/**
 * Write a title difference. Returns how it was classified so callers can log and count honestly.
 * The title_change feed event is not written here — scripts/feed-materialize.ts derives it from
 * the title_versions row, and skips rows marked backfill.
 */
export async function recordTitleChange(
  pool: pg.Pool,
  videoId: string,
  oldTitle: string,
  newTitle: string,
  publishedAt: Date | string | null,
  now: Date,
  titleObservedAt: Date | string | null = null
): Promise<{ kind: TitleDiffKind; version: number }> {
  const kind = classifyTitleDiff({ publishedAt, titleObservedAt }, now);
  const backfill = kind === 'sync';

  const { rows } = await pool.query(
    `select coalesce(max(version), 0)::int as v from title_versions where video_id = $1`, [videoId]
  );
  const plan = titleVersionPlan(rows[0].v);
  if (plan.seedVersion1) {
    await pool.query(
      `insert into title_versions (video_id, version, title, first_seen, backfill)
       values ($1, 1, $2, $3, true) on conflict do nothing`,
      [videoId, oldTitle, publishedAt ?? now]
    );
  }
  await pool.query(
    `insert into title_versions (video_id, version, title, backfill) values ($1, $2, $3, $4)
     on conflict do nothing`,
    [videoId, plan.newVersion, newTitle, backfill]
  );
  await pool.query(
    `update videos set title = $1, title_observed_at = $3, updated_at = now() where id = $2`,
    [newTitle, videoId, now]
  );

  // A version > 1 is a packaging change, which the channel list surfaces from the
  // materialized channel_stats row (lib/app/channel-stats.ts). Single-row touch, no
  // aggregate recompute. Best effort: a stale timestamp must not fail the write above.
  if (plan.newVersion > 1) {
    const touched = await pool.query(
      // UPDATE only — a stub row here would read as video_count 0 on the channel list until
      // the next full refresh (which recomputes this timestamp anyway).
      `update channel_stats cs
          set last_packaging_change = greatest(cs.last_packaging_change, $2::timestamptz),
              updated_at = now()
         from videos v
        where v.id = $1 and cs.channel_id = v.channel_id
      returning cs.channel_id`,
      [videoId, now]
    ).catch(() => ({ rows: [] as any[] }));
    // The watcher runs outside Next, so the cached video/channel reads are dropped over HTTP
    // (lib/app/revalidate-remote.ts). Best effort; a miss only means a stale page for the TTL.
    await revalidateRemote({ videos: [{ id: videoId, channelId: touched.rows[0]?.channel_id ?? null }] });
  }

  // Only real news re-opens the stats lane's 5-minute change ladder.
  if (!backfill) {
    const r = reenter(now);
    await pool.query(
      `update track_schedule set phase = $1, launch_until = $2, next_check = $3,
              entered_reason = 'title_change', last_title_check = now(), updated_at = now()
        where video_id = $4`,
      [r.phase, r.launch_until, r.next_check, videoId]
    );
  } else {
    await pool.query(
      `update track_schedule set last_title_check = now() where video_id = $1`, [videoId]
    ).catch(() => {});
  }
  return { kind, version: plan.newVersion };
}
