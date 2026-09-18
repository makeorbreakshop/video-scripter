import pg from 'pg';
import { readCurrentChart, readOrRequestCurrentChart, REQUEST_CHART_BOOTSTRAP_SQL, CURRENT_CHART_SQL, MAX_CHART_STATE_BYTES, MAX_CHART_METADATA_BYTES } from './chart-current';
import { createHybridChartReader } from './hybrid-chart';
import { buildSeriesFile } from './series';
import { emptyObservationState, applyObservationChanges, encodeObservationState } from '../scoring/observation-state';

const dsn = process.env.CHART_TEST_DATABASE_URL;
const local = dsn && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(dsn).hostname);
const suite = local ? describe : describe.skip;
const at = '2026-09-18T12:00:00.000Z';
const old = '2026-08-01T12:00:00.000Z';
const baseState = applyObservationChanges(emptyObservationState('v', old), [
  { videoId: 'v', source: 'sample', operation: 'upsert', at, views: 300, changeId: 9 },
]);

suite('hybrid chart on isolated local PostgreSQL', () => {
  const pool = new pg.Pool({ connectionString: dsn, max: 2 });
  const query = async <T>(sql: string, params: unknown[]) => (await pool.query(sql, params)).rows as T[];
  beforeAll(async () => {
    await pool.query(`
      create table videos(id text primary key, published_at timestamptz);
      create table video_obs_cache(video_id text primary key, obs bytea, built_at timestamptz,
        last_change_id bigint, format int);
      create table obs_cache_dirty(video_id text primary key, generation bigint, requires_bootstrap boolean default false,
        marked_at timestamptz default now(),not_before timestamptz default now());
      create table observation_change_log(video_id text,change_id bigint,primary key(video_id,change_id));
      create table thumbnail_versions(video_id text, version int, first_seen timestamptz, last_checked timestamptz,
        sha256 text, phash text, r2_uploaded_at timestamptz, primary key(video_id, version));
      create table title_versions(video_id text, version int, title text, first_seen timestamptz,
        primary key(video_id, version));
      insert into videos select 'filler-'||i, now() from generate_series(1,10000) i;
      insert into video_obs_cache select id, '\\x00'::bytea, now(), 1, 2 from videos;
      insert into videos values ('v', '${old}');
      analyze;
    `);
  });
  beforeEach(async () => {
    await pool.query('delete from obs_cache_dirty; delete from title_versions; delete from thumbnail_versions; delete from observation_change_log');
    await pool.query(`insert into video_obs_cache values ('v',$1,$2,9,2)
      on conflict(video_id) do update set obs=excluded.obs, built_at=excluded.built_at, last_change_id=9,format=2`,
    [encodeObservationState(baseState), at]);
  });
  afterAll(async () => {
    await pool.query('drop table title_versions,thumbnail_versions,obs_cache_dirty,video_obs_cache,videos,observation_change_log');
    await pool.end();
  });

  test('real SQL + reader preserves a saved historical point and serves a new observation', async () => {
    const read = createHybridChartReader({ current: id => readCurrentChart(id, query),
      baseline: async () => buildSeriesFile({ videoId: 'v', builtAt: old, publishedAt: old,
        samples: [{ at: old, views: 100 }] }) });
    const result = await read('v');
    expect(result.status).toBe('current');
    expect(result.file?.samples.map(p => p.views)).toEqual([100, 300]);
    expect(result.asOf).toBe(at);
  });

  test('new-generation dirty state cannot masquerade as fresh data', async () => {
    await pool.query("insert into obs_cache_dirty values('v',10,false)");
    expect(await readCurrentChart('v', query)).toBeNull();
    await pool.query('update obs_cache_dirty set generation=9');
    expect((await readCurrentChart('v', query))?.samples[0].views).toBe(300);
    await pool.query('update obs_cache_dirty set requires_bootstrap=true');
    expect(await readCurrentChart('v', query)).toBeNull();
  });

  test('oversized state and packaging are rejected at the server before returning payloads', async () => {
    await pool.query("update video_obs_cache set obs=$1 where video_id='v'", [Buffer.alloc(MAX_CHART_STATE_BYTES + 1)]);
    const rows = await query<any>(CURRENT_CHART_SQL, ['v', MAX_CHART_STATE_BYTES, MAX_CHART_METADATA_BYTES]);
    expect(rows[0].obs).toBeNull();
    await pool.query("update video_obs_cache set obs=$1 where video_id='v'", [encodeObservationState(baseState)]);
    await pool.query("insert into title_versions select 'v',i,'title',now() from generate_series(1,501) i");
    expect((await query<any>(CURRENT_CHART_SQL, ['v', MAX_CHART_STATE_BYTES, MAX_CHART_METADATA_BYTES]))[0].metadata).toBeNull();
    expect(await readCurrentChart('v', query)).toBeNull();
  });

  test('real materialized tombstone removes only its matching archived source key', async () => {
    const corrected = applyObservationChanges(baseState, [
      { videoId: 'v', source: 'sample', operation: 'delete', at: old, views: null, changeId: 10 },
    ]);
    await pool.query("update video_obs_cache set obs=$1,last_change_id=10 where video_id='v'", [encodeObservationState(corrected)]);
    const read = createHybridChartReader({ current: id => readCurrentChart(id, query), baseline: async () =>
      buildSeriesFile({ videoId: 'v', publishedAt: old, samples: [{ at: old, views: 100 }], rss: [{ at: old, views: 90 }] }) });
    const result = await read('v');
    expect(result.file?.samples.map(p => p.views)).toEqual([300]);
    expect(result.file?.rss.map(p => p.views)).toEqual([90]);
  });

  test('missing existing video requests one recovery at the captured generation and becomes readable after bootstrap', async () => {
    await pool.query("delete from video_obs_cache where video_id='v'");
    await pool.query("insert into observation_change_log values('v',7),('v',9)");
    expect(await readOrRequestCurrentChart('v', query)).toBeNull();
    await readOrRequestCurrentChart('v', query);
    expect((await pool.query('select video_id,generation,requires_bootstrap from obs_cache_dirty')).rows)
      .toEqual([{ video_id: 'v', generation: '9', requires_bootstrap: true }]);
    await pool.query("insert into video_obs_cache values('v',$1,$2,9,2)", [encodeObservationState(baseState), at]);
    await pool.query("delete from obs_cache_dirty where video_id='v'");
    expect((await readOrRequestCurrentChart('v', query))?.samples[0].views).toBe(300);
    expect((await pool.query('select * from obs_cache_dirty')).rows).toHaveLength(0);
  });

  test('recovery skips unknown videos/current caches and preserves an existing queue generation', async () => {
    await query(REQUEST_CHART_BOOTSTRAP_SQL, ['unknown']);
    await query(REQUEST_CHART_BOOTSTRAP_SQL, ['v']);
    expect((await pool.query('select * from obs_cache_dirty')).rows).toHaveLength(0);
    await pool.query("delete from video_obs_cache where video_id='v'");
    await pool.query("insert into obs_cache_dirty(video_id,generation,requires_bootstrap) values('v',99,false)");
    await query(REQUEST_CHART_BOOTSTRAP_SQL, ['v']);
    expect((await pool.query('select generation,requires_bootstrap from obs_cache_dirty')).rows)
      .toEqual([{generation: '99', requires_bootstrap: false}]);
  });

  test('EXPLAIN uses an indexed video-state lookup', async () => {
    const plan = await pool.query(`explain (analyze,buffers,format json) ${CURRENT_CHART_SQL}`,
      ['v', MAX_CHART_STATE_BYTES, MAX_CHART_METADATA_BYTES]);
    const nodes: any[] = [];
    const visit = (p: any) => { nodes.push(p); (p.Plans ?? []).forEach(visit); };
    visit(plan.rows[0]['QUERY PLAN'][0].Plan);
    expect(nodes.find(p => p['Relation Name'] === 'video_obs_cache')['Node Type']).toMatch(/Index/);
  });
});
