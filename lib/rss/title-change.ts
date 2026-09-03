// The one place a detected title change is written, shared by the two free-lane detectors:
// scripts/rss-poll.ts (channel RSS, covers a channel's last 15 uploads) and
// scripts/thumbnail-watch.ts (oEmbed, covers the 14-90 day videos that have fallen out of the
// RSS window). Keeping it in one module is what stops the two paths from drifting.
//
// The version plan is pure and tested; recordTitleChange is the I/O around it.
import type pg from 'pg';
import { reenter } from '../nightly/launch-core';

export interface TitleVersionPlan {
  /** Archive the title we currently hold as version 1 first? Only when there is no history. */
  seedVersion1: boolean;
  /** Version number the newly observed title gets. */
  newVersion: number;
}

/**
 * title_versions starts empty for most videos: the title we already have in `videos` was never
 * archived. The first change therefore writes TWO rows — v1 (the old title, stamped at publish
 * time) and v2 (the new one) — so the feed event has an old title to show. Later changes just
 * append. Mirrors what launch-track.ts did before the poller took titles over.
 */
export function titleVersionPlan(maxVersion: number): TitleVersionPlan {
  return maxVersion === 0
    ? { seedVersion1: true, newVersion: 2 }
    : { seedVersion1: false, newVersion: maxVersion + 1 };
}

/**
 * Write a confirmed title change: archive both sides in title_versions, move videos.title, and
 * re-enter the video into the stats lane's change ladder. The title_change feed event is not
 * written here — scripts/feed-materialize.ts derives it from the title_versions row.
 */
export async function recordTitleChange(
  pool: pg.Pool,
  videoId: string,
  oldTitle: string,
  newTitle: string,
  publishedAt: Date | string | null,
  now: Date
): Promise<number> {
  const { rows } = await pool.query(
    `select coalesce(max(version), 0)::int as v from title_versions where video_id = $1`, [videoId]
  );
  const plan = titleVersionPlan(rows[0].v);
  if (plan.seedVersion1) {
    await pool.query(
      `insert into title_versions (video_id, version, title, first_seen) values ($1, 1, $2, $3)
       on conflict do nothing`,
      [videoId, oldTitle, publishedAt ?? now]
    );
  }
  await pool.query(
    `insert into title_versions (video_id, version, title) values ($1, $2, $3) on conflict do nothing`,
    [videoId, plan.newVersion, newTitle]
  );
  await pool.query(`update videos set title = $1, updated_at = now() where id = $2`, [newTitle, videoId]);
  const r = reenter(now);
  await pool.query(
    `update track_schedule set phase = $1, launch_until = $2, next_check = $3,
            entered_reason = 'title_change', last_title_check = now(), updated_at = now()
      where video_id = $4`,
    [r.phase, r.launch_until, r.next_check, videoId]
  );
  return plan.newVersion;
}
