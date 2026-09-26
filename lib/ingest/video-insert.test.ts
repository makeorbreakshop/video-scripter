import { videoInsertSql, videoInsertParams, SYSTEM_USER } from './video-insert';
import { broadcastMetadataWrite } from './first-sample';

// "Why do new ingests write text into `videos` at all?" (2026-09-26). Until today the three
// live insert paths — scripts/nightly-ingest.ts, scripts/drain-touch-queue.ts and
// lib/app/channels.ts insertVideos — each carried a copy of the same INSERT, and none of them
// wrote video_text. Every new video therefore started life "unmoved", which kept the
// null-out's old global gate shut for ever and made the mover re-find 3-30 K rows a night.
// One builder now, and it writes the side row in the same statement.

const item = {
  id: 'abc123def45',
  snippet: {
    title: 'A title', description: 'x'.repeat(60_000), channelId: 'UCxyz', channelTitle: 'Chan',
    publishedAt: '2026-09-25T10:00:00Z', thumbnails: { high: { url: 'https://i/h.jpg' } },
  },
  statistics: { viewCount: '12', likeCount: '3', commentCount: '1' },
  contentDetails: { duration: 'PT10M' },
};
const cls = { kind: 'longform', is_short: false, shorts_checked_at: 'now' } as any;

describe('the one ingest INSERT', () => {
  it('writes the side row in the same statement, only for a row it actually inserted', () => {
    const sql = videoInsertSql(['llm_summary']);
    expect(sql).toMatch(/insert into videos \(/);
    expect(sql).toMatch(/returning id, \(xmax = 0\) as inserted/);
    expect(sql).toMatch(/insert into video_text \(video_id, description, metadata, llm_summary, moved_at\)/);
    expect(sql).toMatch(/from ins where inserted/);
    // A re-import never overwrites the side copy (the videos row itself keeps its description too).
    expect(sql).toMatch(/on conflict \(video_id\) do nothing/);
  });

  it('keeps writing videos.description while description still has direct readers', () => {
    const sql = videoInsertSql(['llm_summary']);
    expect(sql).toMatch(/insert into videos \(id, title, description,/);
  });

  it('stops writing videos.description the moment description is cleared', () => {
    const sql = videoInsertSql(['llm_summary', 'description']);
    expect(sql).toMatch(/insert into videos \(id, title, channel_id,/);
    expect(sql).not.toMatch(/insert into videos \([^)]*description/);
    // …and the text still lands, in video_text.
    expect(sql).toMatch(/select id, \$3::text, null, null, now\(\) from ins where inserted/);
  });

  it('never writes llm_summary or metadata into videos at insert', () => {
    const sql = videoInsertSql(['llm_summary']);
    expect(sql).not.toMatch(/insert into videos \([^)]*(llm_summary|metadata)/);
  });

  it('preserves the Shorts verdict rule on conflict (lib/ingest/is-short-trigger.test.ts)', () => {
    const sql = videoInsertSql(['llm_summary']);
    expect(sql).toMatch(/is_short = case when excluded\.shorts_checked_at is not null then excluded\.is_short else videos\.is_short end/);
    expect(sql).toMatch(/shorts_checked_at = coalesce\(excluded\.shorts_checked_at, videos\.shorts_checked_at\)/);
  });

  it('builds the parameters once, in the order the SQL expects', () => {
    const p = videoInsertParams(item, cls, { dataSource: 'competitor', userId: SYSTEM_USER });
    expect(p).toHaveLength(15);
    expect(p[0]).toBe('abc123def45');
    expect((p[2] as string).length).toBe(50_000); // truncated, as every copy did
    expect(p.slice(6, 9)).toEqual([12, 3, 1]);
    expect(p[10]).toBe('https://i/h.jpg');
    expect(p[11]).toBe('competitor');
    expect(p[12]).toBe(SYSTEM_USER);
    expect(p.slice(13)).toEqual([false, true]);
  });
});

describe('the live-broadcast metadata write keeps both copies equal', () => {
  const live = { id: 'abc123def45', snippet: { liveBroadcastContent: 'upcoming' },
                 liveStreamingDetails: { scheduledStartTime: '2026-09-27T00:00:00Z' } };

  it('while metadata is blocked: updates videos AND mirrors the result into video_text', () => {
    const w = broadcastMetadataWrite(live, ['llm_summary'])!;
    expect(w.sql).toMatch(/update videos set metadata = /);
    expect(w.sql).toMatch(/returning id, description, metadata, llm_summary/);
    expect(w.sql).toMatch(/insert into video_text \(video_id, description, metadata, llm_summary, moved_at\)/);
    expect(w.sql).toMatch(/on conflict \(video_id\) do update set metadata = excluded\.metadata/);
  });

  it('a first side row copies ALL three columns, so the mover never skips its description', () => {
    // Inserting only metadata would create a side row with a NULL description; the mover's
    // anti-join would then treat the video as moved and never copy the real one.
    const w = broadcastMetadataWrite(live, ['llm_summary'])!;
    expect(w.sql).toMatch(/select id, description, metadata, llm_summary, now\(\) from upd/);
  });

  it('once metadata is cleared: writes video_text only', () => {
    const w = broadcastMetadataWrite(live, ['llm_summary', 'metadata'])!;
    expect(w.sql).not.toMatch(/update videos/);
    expect(w.sql).toMatch(/insert into video_text/);
    expect(w.sql).toMatch(/on conflict \(video_id\) do update set metadata = /);
    expect(w.sql).toMatch(/video_text\.metadata/);
  });
});
