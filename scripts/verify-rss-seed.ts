/** Rollback-only parity fixture for the complete RSS channel seed, including edge cases. */
import dotenv from 'dotenv';
import pg from 'pg';
import assert from 'node:assert/strict';
import { SEED_ALL_SQL } from '../lib/rss/poll-policy';
dotenv.config({ path: '.env.local', quiet: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('begin');
  await client.query("set local statement_timeout='8s'");
  await client.query(`create temp table videos(id text,channel_id text,published_at timestamptz,is_short boolean);
    create temp table channel_rss_state(channel_id text primary key,last_upload_at timestamptz,rss_state text,updated_at timestamptz);
    insert into videos values
      ('a1','a',now()-interval '2 days',false),('a2','a',now()-interval '1 day',true),
      ('b1','b',now()-interval '90 days',false),('c1','c',null,false),
      ('d1','d',now()-interval '100 days',false),('missing',null,now(),false);
    insert into channel_rss_state values('d',null,'woken',now());`);
  const expected = (await client.query(`select channel_id,max(published_at) as last_upload_at,
    case when channel_id='d' then 'woken' when max(published_at)>now()-interval '60 days' then 'active' else 'dormant' end rss_state
    from videos where channel_id is not null group by channel_id order by channel_id`)).rows;
  await client.query(SEED_ALL_SQL);
  const actual = (await client.query('select channel_id,last_upload_at,rss_state from channel_rss_state order by channel_id')).rows;
  assert.deepEqual(actual,expected);
  assert.equal((await client.query(SEED_ALL_SQL)).rowCount,0,'unchanged channel state must not be rewritten');
  assert.equal((await client.query('select count(*)::int n from channel_rss_state')).rows[0].n,4);
  console.log('RSS seed parity: PASS (all channels, Shorts, null dates, wake state, idempotence)');
} finally { await client.query('rollback'); await client.end(); }
