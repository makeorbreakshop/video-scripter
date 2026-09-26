// The one INSERT that brings a new video into the corpus — and its text into video_text.
//
// Until 2026-09-26 scripts/nightly-ingest.ts, scripts/drain-touch-queue.ts and
// lib/app/channels.ts insertVideos each carried their own copy of this statement, and none of
// them wrote video_text. Every new video was born "unmoved": the nightly mover had to find it
// again, and the null-out's old global gate ("zero unmoved videos") could never open because
// ingest refilled that queue faster than the gate could observe it empty.
//
// Now the side row is written in the same statement, for a row the statement actually inserted
// (`xmax = 0` on the RETURNING row — an ON CONFLICT update leaves the existing text alone, as
// every copy of this statement always did). Whether `videos.description` is ALSO written depends
// on the one list of cleared columns (lib/app/video-text-move.ts CLEARED_COLUMNS): while the
// column still has direct readers it is written to both; once cleared, to video_text only.
import { clampCount } from '../nightly/tracking-core';
import type { InsertClassification } from './classify';

// The SQL lives in the accessor (lib/app/video-text.ts), the one module allowed to name the text
// columns against `videos` (lib/app/video-text-sweep.ts ALLOWED).
export { videoInsertSql } from '../app/video-text';

export const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

/** Parameters for videoInsertSql, in its order. */
export function videoInsertParams(
  v: any,
  cls: Pick<InsertClassification, 'is_short' | 'shorts_checked_at'>,
  { dataSource, userId }: { dataSource: string; userId: string },
): unknown[] {
  const sn = v.snippet || {};
  const st = v.statistics || {};
  const n = (x: unknown) => clampCount(parseInt(String(x || '0'), 10));
  return [
    v.id,
    sn.title || '',
    (sn.description || '').slice(0, 50000),
    sn.channelId,
    sn.channelTitle || '',
    sn.publishedAt,
    n(st.viewCount),
    n(st.likeCount),
    n(st.commentCount),
    v.contentDetails?.duration || null,
    sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || null,
    dataSource,
    userId,
    cls.is_short,
    cls.shorts_checked_at === 'now',
  ];
}
