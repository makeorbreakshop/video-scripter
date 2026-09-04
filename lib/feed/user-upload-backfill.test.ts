import {
  buildUserUploadBackfillUnits, unfinishedUserUploadChannelsSql,
  userUploadBackfillPageSql, USER_UPLOAD_BACKFILL_COMPLETE,
} from './user-upload-backfill';

const row = (id: string, at: string) => ({ video_id: id, published_at: at });

test('pages multiple unfinished channels fairly within a global row bound', async () => {
  const channels = ['a', 'b', 'c'].map(channelId => ({ channelId, watermarkSource: `wm:${channelId}`, cursor: null }));
  const seen: string[] = [];
  const units = await buildUserUploadBackfillUnits({ channels, pageSize: 2, globalLimit: 4,
    fetchPage: async c => { seen.push(c.channelId); return [row(`${c.channelId}2`, '2026-01-01 00:00:00.123456+00'), row(`${c.channelId}1`, '2025-01-01 00:00:00+00')]; },
  });
  expect(seen).toEqual(['a', 'b']);
  expect(units.flatMap(u => u.rows)).toHaveLength(4);
});

test('keeps the exact timestamp text and id tie-breaker when resuming', async () => {
  const precise = '2026-01-01 00:00:00.123456+00';
  const [unit] = await buildUserUploadBackfillUnits({ channels: [{ channelId: 'a', watermarkSource: 'wm:a', cursor: null }], pageSize: 2, globalLimit: 2,
    fetchPage: async () => [row('z', precise), row('a', precise)],
  });
  expect(unit.cursor).toEqual({ at: precise, id: 'a' });
  const sql = userUploadBackfillPageSql(true, 2);
  expect(sql).toContain('(v.published_at, v.id) < ($2::timestamptz, $3)');
  expect(sql).toContain('v.published_at::text');
});

test('marks a short or empty page complete and retrying starts from the saved cursor', async () => {
  const cursor = { at: '2025-01-01 00:00:00+00', id: 'v2' };
  const [unit] = await buildUserUploadBackfillUnits({ channels: [{ channelId: 'a', watermarkSource: 'wm:a', cursor }], pageSize: 3, globalLimit: 3,
    fetchPage: async c => { expect(c.cursor).toEqual(cursor); return [row('v1', '2024-01-01 00:00:00+00')]; },
  });
  expect(unit.complete).toBe(true);
  expect(unit.cursor?.id).toBe('v1');
});

test('stops before fetching another channel when aborted', async () => {
  let calls = 0;
  const units = await buildUserUploadBackfillUnits({ channels: [{ channelId: 'a', watermarkSource: 'wm:a', cursor: null }, { channelId: 'b', watermarkSource: 'wm:b', cursor: null }], pageSize: 2, globalLimit: 4,
    aborted: () => calls > 0, fetchPage: async () => { calls++; return [row('v', '2025-01-01 00:00:00+00')]; },
  });
  expect(units).toHaveLength(1);
});

test('completed channels are excluded while absent newly tracked channels sort first', () => {
  const sql = unfinishedUserUploadChannelsSql(10);
  expect(sql).toContain("ct.backfill_status in ('done', 'failed')");
  expect(sql).toContain(`w.last_id <> '${USER_UPLOAD_BACKFILL_COMPLETE}'`);
  expect(sql).toContain('(w.source is null) desc');
  expect(sql).toContain('limit 10');
});

test('waits for catalog completion so a cursor cannot step past history still being imported', () => {
  expect(unfinishedUserUploadChannelsSql(10)).toContain("backfill_status in ('done', 'failed')");
});

test('a later promotion gets a fresh watermark generation', () => {
  const sql = unfinishedUserUploadChannelsSql(10);
  expect(sql).toContain("ct.channel_id || ':' || ct.promoted_at::text");
  expect(sql).toContain('as watermark_source');
});

test('pages unresolved Shorts too so later verification can expose their stored events', () => {
  const sql = userUploadBackfillPageSql(false, 10);
  expect(sql).not.toContain('is_short');
  expect(sql).not.toContain('duration');
});

test('runtime no longer performs a global upload anti-scan', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(`${process.cwd()}/scripts/feed-materialize.ts`, 'utf8');
  expect(source).toContain('buildUserUploadBackfillUnits');
  expect(source).not.toContain("not exists (select 1 from feed_events f where f.type = 'upload'");
  expect(source).toContain("exists (select 1 from channel_tracking ct where ct.channel_id = videos.channel_id and ct.lane = 'user')");
  expect(source).not.toMatch(/pool\.on\(['"]connect['"]/);
  expect(source).toContain("set local statement_timeout = '60s'");
});
