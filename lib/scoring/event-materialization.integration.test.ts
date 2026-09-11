import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { materializeObservationBatch, MATERIALIZER_LIMITS } from './observation-materializer';
import { decodeObservationState } from './observation-state';
import { SCORE_DIRTY_CLEAR_SQL } from './materialization-queue';

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
        import_date timestamptz not null default now()
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
  }, 30_000);

  beforeEach(async () => {
    await pool.query(`truncate view_snapshots,view_samples,rss_samples,videos,observation_change_log,
      obs_cache_dirty,score_dirty,series_dirty,video_obs_cache restart identity`);
  });

  afterAll(async () => {
    const rollback = fs.readFileSync(path.join(process.cwd(), 'sql/rollback/2026-09-11-event-driven-scoring.sql'), 'utf8');
    await pool.query(rollback).catch(() => {});
    await pool.query('drop table if exists rss_samples,view_samples,view_snapshots,videos cascade').catch(() => {});
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

  test('an exact-generation clear cannot erase a concurrent score mark', async () => {
    await addVideo();
    await pool.query("insert into rss_samples(video_id,at,views,received_at) values('video',now(),120,clock_timestamp())");
    const first = (await pool.query('select video_id,generation from score_dirty')).rows[0];
    await pool.query("insert into rss_samples(video_id,at,views,received_at) values('video',now()+interval '1 second',121,clock_timestamp())");
    await pool.query(SCORE_DIRTY_CLEAR_SQL, [JSON.stringify([{ video_id: first.video_id, generation: Number(first.generation) }])]);
    expect(Number((await pool.query('select count(*) n from score_dirty')).rows[0].n)).toBe(1);
  });

  test('internal tables and the security-definer enqueue function are not exposed', async () => {
    const row = (await pool.query(`select
      has_function_privilege('anon','public.enqueue_observation_changes(jsonb)','execute') as anon_execute,
      has_table_privilege('authenticated','public.observation_change_log','select') as authenticated_read,
      (select relrowsecurity from pg_class where oid='public.video_obs_cache'::regclass) as cache_rls`)).rows[0];
    expect(row).toEqual({ anon_execute: false, authenticated_read: false, cache_rls: true });
  });
});
