import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { materializeObservationBatch, MATERIALIZER_LIMITS } from './observation-materializer';
import { decodeObservationState } from './observation-state';
import { OBS_DIRTY_CLAIM_SQL, SCORE_DIRTY_CLEAR_SQL } from './materialization-queue';
import { OBS_CACHE_SERIES_READ_SQL, OBS_CACHE_V2_UPSERT_SQL } from './obs-cache';
import { makeTimedPool } from '../admin/db';
import { supabaseApplicationName } from '../admin/supabase-trace';

const dsn = process.env.EVENT_MATERIALIZATION_TEST_DATABASE_URL;
const isLocal = dsn && ['localhost', '127.0.0.1', '::1'].includes(new URL(dsn).hostname);
const suite = isLocal ? describe : describe.skip;

suite('event materialization migration (real local PostgreSQL)', () => {
  const pool = new pg.Pool({ connectionString: dsn, max: 2 });

  beforeAll(async () => {
    await pool.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
        if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      end $$;
      create table public.videos (
        id text primary key,
        published_at timestamptz,
        import_date timestamptz default now(),
        privacy_status text default 'public',
        is_short boolean default false,
        duration text default 'PT10M',
        shorts_checked_at timestamptz default now()
      );
      create table public.video_scores (
        video_id text primary key,
        scored_at timestamptz
      );
      create table public.view_snapshots (
        video_id text not null,
        snapshot_date date not null,
        view_count bigint,
        created_at timestamptz not null default now(),
        primary key(video_id,snapshot_date)
      );
      create table public.view_samples (
        video_id text not null,
        sampled_at timestamptz not null,
        view_count bigint,
        primary key(video_id,sampled_at)
      );
      create table public.rss_samples (
        video_id text not null,
        at timestamptz not null,
        views bigint,
        time_basis text,
        received_at timestamptz,
        model_eligible boolean not null default true,
        conflicted boolean not null default false,
        primary key(video_id,at)
      );
      create table public.series_dirty (
        video_id text primary key,
        marked_at timestamptz not null default now(),
        attempts integer not null default 0
      );
      create table public.video_obs_cache (
        video_id text primary key,
        built_at timestamptz not null default now(),
        n integer not null,
        obs bytea not null
      );
    `);
    const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260911153000_event_driven_scoring.sql'), 'utf8');
    await pool.query(migration);
    const integrity = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260911221000_derived_video_foreign_keys.sql'), 'utf8');
    await pool.query(integrity);
  }, 30_000);

  beforeEach(async () => {
    await pool.query(`truncate view_snapshots,view_samples,rss_samples,video_scores,videos,observation_change_log,
      obs_cache_dirty,score_dirty,series_dirty,video_obs_cache restart identity`);
  });

  afterAll(async () => {
    const rollback = fs.readFileSync(path.join(process.cwd(), 'sql/rollback/2026-09-11-event-driven-scoring.sql'), 'utf8');
    await pool.query(rollback).catch(() => {});
    await pool.query('drop table if exists rss_samples,view_samples,view_snapshots,video_scores,videos cascade').catch(() => {});
    await pool.end();
  });

  async function addVideo(id = 'video') {
    await pool.query(`insert into videos(id,published_at,import_date)
      values($1,now()-interval '1 day',clock_timestamp())`, [id]);
  }

  test('statement triggers capture every source and coalesce all three queues', async () => {
    await addVideo();
    await pool.query("insert into view_snapshots values('video',current_date,100,clock_timestamp())");
    await pool.query("insert into view_samples values('video',now()-interval '1 hour',110)");
    await pool.query("insert into rss_samples(video_id,at,views,received_at) values('video',now(),120,clock_timestamp())");
    expect((await pool.query('select source from observation_change_log order by change_id')).rows.map((row) => row.source))
      .toEqual(['snapshot', 'sample', 'rss']);
    expect((await pool.query('select requires_bootstrap from obs_cache_dirty')).rows)
      .toEqual([{ requires_bootstrap: false }]);
    for (const table of ['score_dirty', 'series_dirty']) {
      expect(Number((await pool.query(`select count(*) n from ${table}`)).rows[0].n)).toBe(1);
    }
  });

  test('one 5,000-row observation statement produces one coalesced queue row per lane', async () => {
    await addVideo();
    const inserted = await pool.query(`insert into view_samples(video_id,sampled_at,view_count)
      select 'video', now() - (g * interval '1 second'), g
        from generate_series(1,5000) g`);
    expect(inserted.rowCount).toBe(5_000);
    expect(Number((await pool.query('select count(*) n from observation_change_log')).rows[0].n)).toBe(5_000);
    for (const table of ['obs_cache_dirty', 'score_dirty', 'series_dirty']) {
      expect(Number((await pool.query(`select count(*) n from ${table}`)).rows[0].n)).toBe(1);
    }
  });

  test('deleting a video cascades every derived projection and work queue', async () => {
    await addVideo();
    await pool.query(`truncate observation_change_log,obs_cache_dirty,score_dirty,series_dirty,
      video_obs_cache,video_day30_truth restart identity`);
    await pool.query(`
      insert into observation_change_log(video_id,source,operation,at,views)
        values('video','sample','upsert',now(),100);
      insert into obs_cache_dirty(video_id,generation) values('video',1);
      insert into score_dirty(video_id,generation) values('video',1);
      insert into series_dirty(video_id,generation) values('video',1);
      insert into video_obs_cache(video_id,n,obs,format,last_change_id)
        values('video',1,'x'::bytea,2,1);
      insert into video_day30_truth(video_id,snapshot_day,snapshot_date,views)
        values('video',30,current_date,100);
      delete from videos where id='video';
    `);
    for (const table of [
      'observation_change_log', 'obs_cache_dirty', 'score_dirty',
      'series_dirty', 'video_obs_cache', 'video_day30_truth',
    ]) {
      expect(Number((await pool.query(`select count(*) n from ${table}`)).rows[0].n)).toBe(0);
    }
  });

  test('unknown RSS ids do not leak into the delta log and later imports bootstrap their history', async () => {
    await pool.query("insert into rss_samples(video_id,at,views,received_at) values('late',now(),100,clock_timestamp())");
    expect(Number((await pool.query("select count(*) n from observation_change_log where video_id='late'")).rows[0].n)).toBe(0);
    expect(Number((await pool.query("select count(*) n from obs_cache_dirty where video_id='late'")).rows[0].n)).toBe(0);
    await addVideo('late');
    expect((await pool.query("select generation,requires_bootstrap from obs_cache_dirty where video_id='late'")).rows[0])
      .toEqual({ generation: '0', requires_bootstrap: true });
  });

  test('updates emit delete then upsert so a changed source key cannot leave a ghost point', async () => {
    await addVideo();
    await pool.query("insert into view_samples values('video','2026-09-11T10:00:00Z',100)");
    await pool.query("update view_samples set sampled_at='2026-09-11T11:00:00Z',view_count=110 where video_id='video'");
    const rows = (await pool.query(`select operation,at::text,views::int from observation_change_log
      where source='sample' order by change_id`)).rows;
    expect(rows.map((row) => [row.operation, row.views])).toEqual([
      ['upsert', 100], ['delete', null], ['upsert', 110],
    ]);
    expect(rows[1].at).not.toBe(rows[2].at);
  });

  test('the real claim/apply/clear transaction creates a clean format-2 row', async () => {
    await addVideo();
    await pool.query("insert into rss_samples(video_id,at,views,received_at) values('video',now(),120,clock_timestamp())");
    const client = await pool.connect();
    try {
      const result = await materializeObservationBatch(client, {
        maxVideos: MATERIALIZER_LIMITS.videos,
        maxChanges: MATERIALIZER_LIMITS.changes,
        maxCacheBytes: MATERIALIZER_LIMITS.cacheBytes,
        maxCompressedBytes: MATERIALIZER_LIMITS.compressedBytes,
      });
      expect(result.completed).toHaveLength(1);
    } finally {
      client.release();
    }
    const cached = (await pool.query('select format,last_change_id,obs from video_obs_cache')).rows[0];
    expect(cached.format).toBe(2);
    expect(decodeObservationState(cached.obs).points.map((point) => point.views)).toEqual([120]);
    expect(Number((await pool.query('select count(*) n from obs_cache_dirty')).rows[0].n)).toBe(0);
    expect(Number((await pool.query('select count(*) n from observation_change_log')).rows[0].n)).toBe(0);
  });

  test('an open materializer claim does not block concurrent observation ingestion', async () => {
    await addVideo();
    await pool.query("insert into rss_samples(video_id,at,views,received_at) values('video',now(),120,clock_timestamp())");
    const materializer = await pool.connect();
    const ingest = await pool.connect();
    try {
      await materializer.query('begin');
      await materializer.query(OBS_DIRTY_CLAIM_SQL, [10, 1_000_000]);
      await ingest.query('set statement_timeout=500');
      await expect(ingest.query(
        "insert into rss_samples(video_id,at,views,received_at) values('video',now()+interval '1 second',121,clock_timestamp())",
      )).resolves.toEqual(expect.objectContaining({ rowCount: 1 }));
    } finally {
      await materializer.query('rollback').catch(() => {});
      await ingest.query('reset statement_timeout').catch(() => {});
      materializer.release();
      ingest.release();
    }
  });

  test('an exact-generation clear cannot erase a concurrent score mark', async () => {
    await addVideo();
    await pool.query("insert into rss_samples(video_id,at,views,received_at) values('video',now(),120,clock_timestamp())");
    const first = (await pool.query('select video_id,generation from score_dirty')).rows[0];
    await pool.query("insert into rss_samples(video_id,at,views,received_at) values('video',now()+interval '1 second',121,clock_timestamp())");
    await pool.query(SCORE_DIRTY_CLEAR_SQL, [JSON.stringify([{ video_id: first.video_id, generation: Number(first.generation) }])]);
    expect(Number((await pool.query('select count(*) n from score_dirty')).rows[0].n)).toBe(1);
  });

  test('a stale materializer cannot overwrite a newer cache watermark', async () => {
    await addVideo();
    await pool.query(OBS_CACHE_V2_UPSERT_SQL, [['video'], [1], [Buffer.from('new')], [10]]);
    await pool.query(OBS_CACHE_V2_UPSERT_SQL, [['video'], [1], [Buffer.from('stale')], [9]]);
    const row = (await pool.query('select last_change_id,obs from video_obs_cache where video_id=$1', ['video'])).rows[0];
    expect(Number(row.last_change_id)).toBe(10);
    expect(row.obs.toString()).toBe('new');
  });

  test('the series cache query returns only a tiny sentinel when a chunk exceeds its wire budget', async () => {
    await addVideo('a');
    await addVideo('b');
    await pool.query(OBS_CACHE_V2_UPSERT_SQL, [
      ['a', 'b'], [1, 1], [Buffer.from('aaa'), Buffer.from('bbb')], [0, 0],
    ]);
    const rejected = (await pool.query(OBS_CACHE_SERIES_READ_SQL, [['a', 'b'], 5])).rows;
    expect(rejected).toEqual([expect.objectContaining({ video_id: null, obs: null, total_cache_bytes: '6' })]);
    const accepted = (await pool.query(OBS_CACHE_SERIES_READ_SQL, [['a', 'b'], 6])).rows;
    expect(accepted.map((row) => row.video_id).sort()).toEqual(['a', 'b']);
    expect(accepted.every((row) => row.obs.length === 3)).toBe(true);
  });

  test('observation marks are scheduled at the score cadence and do not delay a rollout', async () => {
    await pool.query(`insert into videos(id,published_at,import_date)
      values('old',now()-interval '100 days',clock_timestamp()),
            ('due',now()-interval '100 days',clock_timestamp()),
            ('rollout',now()-interval '100 days',clock_timestamp())`);
    await pool.query(`insert into video_scores(video_id,scored_at) values
      ('old',clock_timestamp()),('due',clock_timestamp()),('rollout',clock_timestamp())`);
    await pool.query(`insert into score_dirty(video_id,reason,not_before)
      values('rollout','model-rollout',clock_timestamp()),
            ('due','observation',clock_timestamp())`);
    await pool.query(`insert into rss_samples(video_id,at,views,received_at) values
      ('old',now(),100,clock_timestamp()),('due',now(),100,clock_timestamp()),
      ('rollout',now(),100,clock_timestamp())`);
    const rows = (await pool.query(`select video_id,reason,
      extract(epoch from not_before-now())::int as due_in from score_dirty order by video_id`)).rows;
    expect(rows[0].video_id).toBe('due');
    expect(rows[0].reason).toBe('observation');
    expect(Number(rows[0].due_in)).toBeLessThanOrEqual(1);
    expect(rows[1].video_id).toBe('old');
    expect(rows[1].reason).toBe('observation');
    expect(Number(rows[1].due_in)).toBeGreaterThan(6 * 24 * 60 * 60);
    expect(rows[2].video_id).toBe('rollout');
    expect(rows[2].reason).toBe('model-rollout');
    expect(Number(rows[2].due_in)).toBeLessThanOrEqual(1);
  });

  test('a nullable pre-cutover import date safely requires bootstrap', async () => {
    await pool.query("insert into videos(id,published_at,import_date) values('legacy',now()-interval '1 day',null)");
    await pool.query("insert into rss_samples(video_id,at,views,received_at) values('legacy',now(),100,clock_timestamp())");
    expect((await pool.query("select requires_bootstrap from obs_cache_dirty where video_id='legacy'")).rows[0])
      .toEqual({ requires_bootstrap: true });
  });

  test('internal tables and the security-definer enqueue function are not exposed', async () => {
    const row = (await pool.query(`select
      has_function_privilege('anon','public.enqueue_observation_changes(jsonb)','execute') as anon_execute,
      has_table_privilege('authenticated','public.observation_change_log','select') as authenticated_read,
      (select relrowsecurity from pg_class where oid='public.video_obs_cache'::regclass) as cache_rls`)).rows[0];
    expect(row).toEqual({ anon_execute: false, authenticated_read: false, cache_rls: true });
  });

  test('the timed pool exposes its component inside the guarded transaction', async () => {
    const applicationName = supabaseApplicationName('trace-integration');
    const tagged = makeTimedPool({
      connectionString: dsn,
      max: 1,
      timeoutMs: 30_000,
      application_name: applicationName,
    });
    try {
      const row = (await tagged.query("select current_setting('application_name') as name")).rows[0];
      expect(row.name).toBe(applicationName);
    } finally {
      await tagged.end();
    }
  });

  test('the migration reapplies without duplicate triggers or duplicate capture', async () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260911153000_event_driven_scoring.sql'),
      'utf8',
    );
    await pool.query(migration);
    const triggerCount = Number((await pool.query(`select count(*) n from pg_trigger
      where not tgisinternal and tgname like 'queue_%'`)).rows[0].n);
    expect(triggerCount).toBe(10);
    await addVideo();
    await pool.query("insert into rss_samples(video_id,at,views,received_at) values('video',now(),100,clock_timestamp())");
    expect(Number((await pool.query('select count(*) n from observation_change_log')).rows[0].n)).toBe(1);
  });
});
