// Synthetic, isolated PostgreSQL only. No .env files or production connections.
// RUN_LOCAL_PG_TESTS=1 node --test lib/nightly/sampling-candidates.postgres.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const pg = require('pg');
const ts = require('typescript');

test('database tier selection preserves candidates and returns no unrelated history', {
  skip: process.env.RUN_LOCAL_PG_TESTS !== '1', timeout: 60000,
}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sampling-pg-'));
  const data = path.join(dir, 'data');
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'sampling-candidates.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'require', 'module', compiled)(mod.exports, require, mod);
  const { dueSamplingCandidatesSql } = mod.exports;
  let started = false;
  let client;
  try {
    execFileSync('initdb', ['-D', data, '--no-locale', '--auth-local=trust', '--auth-host=reject'], { stdio: 'pipe' });
    execFileSync('pg_ctl', ['-D', data, '-l', path.join(dir, 'server.log'), '-o', `-k ${dir} -h '' -c shared_buffers=16MB`, '-w', 'start'], { stdio: 'pipe' });
    started = true;
    client = new pg.Client({ host: dir, database: 'postgres', user: os.userInfo().username });
    await client.connect();
    await client.query(`begin;
      create table videos(id text primary key, channel_id text);
      create table thumbnail_versions(video_id text, version int, first_seen timestamptz);
      create table title_versions(video_id text, version int, first_seen timestamptz);
      create table track_schedule(video_id text primary key, channel_id text, published_at timestamptz,
        last_views int, last_sample_at timestamptz, next_check timestamptz, updated_at timestamptz,
        entered_reason text, launch_until timestamptz);
      insert into videos values ('changed','dense-channel'),('title-only','title-channel'),('old','old-channel');
      insert into thumbnail_versions values ('changed',2,now()-interval '1 day'),
        ('changed',3,now()-interval '1 day'),('old',2,now()-interval '61 days'),
        ('first-version',1,now()),('boundary',2,now()-interval '60 days');
      insert into title_versions values ('title-only',2,now()-interval '2 days'),('orphan',2,now()),(null,2,now());
      insert into track_schedule(video_id,channel_id,published_at,last_views,next_check,updated_at,entered_reason,launch_until)
      values
        ('changed','dense-channel',now()-interval '90 minutes',100,now()-interval '2 minutes',now(),'launch',null),
        ('sibling','dense-channel',now()-interval '90 minutes',100,now()-interval '3 minutes',now(),'launch',null),
        ('title-sibling','title-channel',now()-interval '90 minutes',100,now()-interval '4 minutes',now(),'launch',null),
        ('standard',null,now()-interval '30 minutes',100,now()-interval '5 minutes',now(),'launch',null),
        ('routine','other',now()-interval '90 minutes',100,now()-interval '10 minutes',now(),'launch',null),
        ('orphan',null,now()-interval '90 minutes',100,now()-interval '6 minutes',now(),'launch',null),
        ('boundary',null,now()-interval '90 minutes',100,now()-interval '7 minutes',now(),'launch',null),
        ('old','old-channel',now()-interval '90 minutes',100,now()-interval '8 minutes',now(),'launch',null),
        ('reentry','other',now()-interval '20 days',100,now()-interval '9 minutes',now(),'title_change',now()+interval '23 hours'),
        ('future','dense-channel',now()+interval '1 day',100,now()-interval '11 minutes',now(),'launch',null),
        ('not-due','dense-channel',now()-interval '10 minutes',100,now()+interval '1 minute',now(),'launch',null);
      insert into videos select 'unrelated-'||i,'unused-channel-'||i from generate_series(1,1000) i;
      insert into title_versions select id,2,now() from videos where id like 'unrelated-%';`);

    const changed = ['changed', 'title-only', 'orphan', ...Array.from({ length: 1000 }, (_, i) => `unrelated-${i + 1}`)];
    const channels = ['dense-channel', 'title-channel', ...Array.from({ length: 1000 }, (_, i) => `unused-channel-${i + 1}`)];
    const legacy = `with urgent as materialized (
      select video_id from track_schedule where next_check <= now() and published_at <= now() and (
        (published_at > now()-interval '2 hours' and (video_id=any($1::text[]) or coalesce(channel_id=any($2::text[]),false)))
        or (published_at > now()-interval '1 hour' and not (video_id=any($1::text[]) or coalesce(channel_id=any($2::text[]),false)))
        or (entered_reason in ('thumbnail_change','title_change') and launch_until>now()+interval '22 hours' and launch_until<=now()+interval '24 hours'))
      order by next_check,video_id limit $3), oldest as materialized (
      select video_id from track_schedule where next_check<=now() order by next_check,video_id limit $4
    ), candidate_ids as (select video_id from urgent union select video_id from oldest)
    select s.video_id,(u.video_id is not null) as reserved_burst,
      (s.video_id=any($1::text[]) or coalesce(s.channel_id=any($2::text[]),false)) as is_dense
    from candidate_ids c join track_schedule s using(video_id) left join urgent u using(video_id)
    order by (u.video_id is not null) desc,s.next_check,s.video_id`;
    for (const [urgentLimit, oldestLimit] of [[10, 10], [2, 3], [0, 3], [3, 0], [0, 0]]) {
      const expected = (await client.query(legacy, [changed, channels, urgentLimit, oldestLimit])).rows;
      const query = dueSamplingCandidatesSql({ urgentLimit, oldestLimit });
      const actual = (await client.query(query.text, query.values)).rows;
      assert.deepEqual(actual.map(({ video_id, reserved_burst, is_dense }) => ({ video_id, reserved_burst, is_dense })), expected);
      assert.ok(actual.length <= urgentLimit + oldestLimit);
      assert.ok(!actual.some(r => r.video_id.startsWith('unrelated-')));
      assert.equal(query.values.length, 2, 'only limits cross the wire; no corpus ID lists');
    }
    await client.query('rollback');
  } finally {
    if (client) await client.end();
    if (started) execFileSync('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'pipe' });
    // Keep the tiny fixture/log directory for failure diagnosis; never delete a user's DB.
  }
});
