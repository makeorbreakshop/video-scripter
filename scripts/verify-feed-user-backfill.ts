import { longformSql } from '../lib/scoring/longform';
/** Rollback-only integration check for the durable user-upload history cursor. */
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import pg from 'pg';
import {
  unfinishedUserUploadChannelsSql, userUploadBackfillPageSql,
  USER_UPLOAD_BACKFILL_COMPLETE, USER_UPLOAD_BACKFILL_PREFIX,
} from '../lib/feed/user-upload-backfill';

dotenv.config({ path: '.env.local', quiet: true });
dotenv.config({ path: '.env', quiet: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('begin');
  await client.query("set local statement_timeout = '8s'");
  await client.query(`
    create temp table channel_tracking (
      channel_id text primary key, lane text, promoted_at timestamptz, backfill_status text
    );
    create temp table feed_watermarks (
      source text primary key, last_at timestamptz not null, last_id text not null
    );
    create temp table videos (
      id text primary key, channel_id text, title text, published_at timestamptz,
      import_date timestamptz, is_short boolean, shorts_checked_at timestamptz, duration text default 'PT2M'
    );
    create temp table feed_events (
      dedupe_key text primary key, video_id text, is_longform boolean
    );
  `);

  const generation1 = '2026-01-01 00:00:00+00';
  const generation2 = '2026-02-01 00:00:00+00';
  await client.query(`insert into channel_tracking values ('c', 'user', $1, 'done')`, [generation1]);
  await client.query(`insert into feed_watermarks values ($1, now(), $2)`,
    [`${USER_UPLOAD_BACKFILL_PREFIX}c:${generation1}`, USER_UPLOAD_BACKFILL_COMPLETE]);
  assert.equal((await client.query(unfinishedUserUploadChannelsSql(10))).rowCount, 0,
    'a completed generation must stay out of later scans');

  await client.query(`update channel_tracking set promoted_at = $1 where channel_id = 'c'`, [generation2]);
  const promoted = (await client.query(unfinishedUserUploadChannelsSql(10))).rows;
  assert.equal(promoted.length, 1, 'a new promotion generation must get a fresh scan');
  assert.match(promoted[0].watermark_source, new RegExp(`^${USER_UPLOAD_BACKFILL_PREFIX}c:`));

  const tied = '2025-01-01 00:00:00.123456+00';
  await client.query(`insert into videos (id,channel_id,title,published_at,import_date,is_short,shorts_checked_at) values
    ('z','c','z',$1,now(),false,now()),
    ('a','c','a',$1,now(),false,now()),
    ('unresolved','c','u','2024-01-01+00',now(),null,null)`, [tied]);
  const first = (await client.query(userUploadBackfillPageSql(false, 2), ['c'])).rows;
  const cursor = first.at(-1)!;
  const second = (await client.query(userUploadBackfillPageSql(true, 2),
    ['c', cursor.published_at, cursor.video_id])).rows;
  assert.deepEqual(first.map(r => r.video_id), ['z', 'a']);
  assert.equal(cursor.published_at, tied, 'cursor must retain PostgreSQL microseconds');
  assert.deepEqual(second.map(r => r.video_id), ['unresolved']);

  // Production inserts unresolved uploads as hidden feed rows; Shorts verification later restamps
  // the same event instead of needing the completed historical scan to revisit it.
  await client.query(`insert into feed_events values ('upload:unresolved', 'unresolved', false)`);
  await client.query(`update videos set is_short=$1, shorts_checked_at=now() where id='unresolved'`, [false]);
  await client.query(`update feed_events e set is_longform = ${longformSql('v')}
                       from videos v where e.video_id=v.id and v.id='unresolved'`);
  assert.equal((await client.query(`select is_longform from feed_events where video_id='unresolved'`)).rows[0].is_longform, true);

  // A unit transaction owns both the deduped event and its cursor. Injected failure rolls both
  // back, and retry produces one event plus one advanced cursor.
  await client.query('savepoint unit');
  await client.query(`insert into feed_events values ('upload:a','a',true) on conflict do nothing`);
  await client.query(`insert into feed_watermarks values ($1,$2,'a') on conflict (source) do update set last_at=excluded.last_at,last_id=excluded.last_id`,
    [promoted[0].watermark_source, tied]);
  await client.query('rollback to savepoint unit');
  assert.equal((await client.query(`select count(*)::int n from feed_events where dedupe_key='upload:a'`)).rows[0].n, 0);
  assert.equal((await client.query(`select count(*)::int n from feed_watermarks where source=$1`, [promoted[0].watermark_source])).rows[0].n, 0);
  await client.query(`insert into feed_events values ('upload:a','a',true) on conflict do nothing`);
  await client.query(`insert into feed_events values ('upload:a','a',true) on conflict do nothing`);
  await client.query(`insert into feed_watermarks values ($1,$2,'a')`, [promoted[0].watermark_source, tied]);
  assert.equal((await client.query(`select count(*)::int n from feed_events where dedupe_key='upload:a'`)).rows[0].n, 1);
  assert.equal((await client.query(`select last_id from feed_watermarks where source=$1`, [promoted[0].watermark_source])).rows[0].last_id, 'a');
  console.log('feed user backfill integration: PASS');
} finally {
  await client.query('rollback').catch(() => {});
  await client.end();
}
