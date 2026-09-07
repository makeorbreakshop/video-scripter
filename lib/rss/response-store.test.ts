import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { saveRssObservations } from './response-store';
import { OBSERVATION_RECORDS_SQL, observationRecords } from '../scoring/observations';
import { CURRENT_RSS_RESPONSES_SQL } from './current-response';
import type { FeedResponse } from './response-freshness';
// Explicit local database only: never fall back to the project's production env.
const url = process.env.RSS_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
const suite = local ? describe : describe.skip;
suite('RSS freshness persistence (real local PostgreSQL)', () => {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const response = (minute: number, dateMinute: number, views: number): FeedResponse => ({
    channelId: 'every', fetchedAt: `2026-09-07T11:${minute}:59Z`,
    date: `2026-09-07T11:${dateMinute}:00Z`, age: '455', cacheControl: 'public, max-age=900', views: { video: views },
  });
  const save = (r: FeedResponse) => saveRssObservations(pool, [{ video_id: 'video', at: r.fetchedAt, views: r.views.video, likes: 0 }], [r]);
  beforeAll(async () => {
    await pool.query('create table videos (id text primary key,published_at timestamptz)');
    await pool.query('create table view_snapshots (video_id text,snapshot_date date,view_count bigint)');
    await pool.query('create table if not exists view_samples (video_id text, sampled_at timestamptz, view_count bigint, primary key(video_id,sampled_at))');
    await pool.query('create table if not exists rss_samples (video_id text, at timestamptz, views bigint check(views>=0), likes bigint, primary key(video_id,at))');
    const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260907120000_rss_response_state.sql'), 'utf8');
    await pool.query(migration);
  });
  beforeEach(async () => { await pool.query('truncate rss_samples, rss_response_state, view_samples, videos, view_snapshots'); });
  afterAll(async () => { await pool.query('drop table rss_samples, rss_response_state, view_samples, videos, view_snapshots'); await pool.end(); });
  test('late counts are preserved at response time, excluded from modeling, and replay deduplicates', async () => {
    await save(response(18, 18, 88694));
    expect(await save(response(19, 11, 88653))).toBe(1);
    await save(response(20, 20, 88000));
    await save(response(20, 20, 88000));
    expect((await pool.query('select views::int from rss_samples order by at')).rows.map(r => r.views)).toEqual([88653, 88694, 88000]);
    const state = (await pool.query('select state from rss_response_state')).rows[0].state;
    expect(state.counters.responses).toBe(3);
    const old=(await pool.query('select at, model_eligible, time_basis from rss_samples where views=88653')).rows[0];
    expect(old.at.toISOString()).toBe('2026-09-07T11:11:00.000Z');
    expect(old.model_eligible).toBe(false);
    expect(old.time_basis).toBe('response-date-estimate');
    expect(state.counters.staleResponses).toBe(1);
    expect(state.counters.acceptedDecreases).toBe(1);
  });
  test('failed sample write rolls back response state and allows a successful retry', async () => {
    const r = response(18, 18, 100);
    await expect(saveRssObservations(pool, [{ video_id: 'video', at: r.fetchedAt, views: -1, likes: 0 }], [r])).rejects.toThrow();
    expect((await pool.query('select count(*)::int n from rss_response_state')).rows[0].n).toBe(0);
    expect(await save(r)).toBe(1);
    expect((await pool.query('select state from rss_response_state')).rows[0].state.counters.responses).toBe(1);
  });
  test('unchanged responses still advance freshness even when no sample is stored', async () => {
    await save(response(18, 18, 100));
    await saveRssObservations(pool, [], [response(20, 20, 100)]);
    expect(await save(response(21, 19, 90))).toBe(1);
    expect((await pool.query('select state from rss_response_state')).rows[0].state.counters.rawComparisons).toBe(2);
  });
  test('concurrent duplicate responses commit one sample and one measurement', async () => {
    const r = response(18, 18, 100);
    const writes = await Promise.all([save(r), save(r)]);
    expect(writes.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await pool.query('select state from rss_response_state')).rows[0].state.counters.responses).toBe(1);
  });
  test('a multi-channel batch preserves late history and another channel’s correction', async () => {
    const first = response(18, 18, 100);
    const other = { ...first, channelId: 'other', views: { second: 200 } };
    await saveRssObservations(pool, [
      { video_id: 'video', at: first.fetchedAt, views: 100, likes: 0 },
      { video_id: 'second', at: other.fetchedAt, views: 200, likes: 0 },
    ], [first, other]);
    const stale = response(19, 11, 90);
    const correction = { ...response(19, 19, 100), channelId: 'other', views: { second: 190 } };
    expect(await saveRssObservations(pool, [
      { video_id: 'video', at: stale.fetchedAt, views: 90, likes: 0 },
      { video_id: 'second', at: correction.fetchedAt, views: 190, likes: 0 },
    ], [stale, correction])).toBe(2);
    expect((await pool.query("select views::int from rss_samples where video_id='second' order by at")).rows.map(r => r.views)).toEqual([200, 190]);
  });
  test('legacy pending samples without headers retain replay compatibility', async () => {
    expect(await saveRssObservations(pool, [{ video_id: 'legacy', at: '2026-09-07T10:00:00Z', views: 10, likes: 0 }], [])).toBe(1);
  });
  test('an older RSS response is chart-only when a newer API anchor already exists', async () => {
    await pool.query("insert into view_samples values ('video','2026-09-07T11:20:00Z',200)");
    await save(response(25, 18, 100));
    expect((await pool.query('select model_eligible from rss_samples')).rows[0].model_eligible).toBe(false);
    await pool.query("insert into videos values ('video','2026-09-01')");
    const rows=(await pool.query(OBSERVATION_RECORDS_SQL,[['video']])).rows;
    expect(observationRecords(rows).get('video')?.map(p=>[p.source,p.views])).toEqual([['sample',200]]);

  });
  test('same-time disagreements in one pending batch are quarantined, not discarded or scheduled', async () => {
    const a=response(18,18,100), b=response(19,18,90);
    await saveRssObservations(pool, [a,b].map(r=>({ video_id:'video', at:r.fetchedAt, views:r.views.video, likes:0 })), [a,b]);
    expect((await pool.query('select conflicted, model_eligible from rss_samples')).rows).toEqual([{conflicted:true,model_eligible:false}]);
    expect((await pool.query(CURRENT_RSS_RESPONSES_SQL,[['video'],['every']])).rows).toEqual([]);
  });
  test('scheduler gets response time after unchanged HTTP responses, never the late fetch time', async () => {
    await save(response(18,18,100));
    const fresh={...response(20,20,100),date:'Mon, 07 Sep 2026 11:20:00 GMT'};
    await saveRssObservations(pool, [], [fresh]);
    await save(response(25,11,90));
    const row=(await pool.query(CURRENT_RSS_RESPONSES_SQL,[['video'],['every']])).rows[0];
    expect(new Date(row.at).toISOString()).toBe('2026-09-07T11:20:00.000Z');
    expect(Number(row.views)).toBe(100);
  });

  test('an older pending fetch still adds chart history without rolling current state back', async () => {
    await save(response(20,20,200));
    expect(await save(response(18,18,100))).toBe(1);
    const rows=(await pool.query('select views::int,model_eligible from rss_samples order by at')).rows;
    expect(rows).toEqual([{views:100,model_eligible:false},{views:200,model_eligible:true}]);
    expect((await pool.query(CURRENT_RSS_RESPONSES_SQL,[['video'],['every']])).rows[0].views).toBe('200');
  });

});
