import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { saveRssObservations } from './response-store';
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
    await pool.query('create table if not exists rss_samples (video_id text, at timestamptz, views bigint check(views>=0), likes bigint, primary key(video_id,at))');
    const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260907120000_rss_response_state.sql'), 'utf8');
    await pool.query(migration);
  });
  beforeEach(async () => { await pool.query('truncate rss_samples, rss_response_state'); });
  afterAll(async () => { await pool.query('drop table rss_samples, rss_response_state'); await pool.end(); });
  test('stale counts never reach the shared observation table; state and counters survive replay', async () => {
    await save(response(18, 18, 88694));
    expect(await save(response(19, 11, 88653))).toBe(0);
    await save(response(20, 20, 88000));
    await save(response(20, 20, 88000));
    expect((await pool.query('select views::int from rss_samples order by at')).rows.map(r => r.views)).toEqual([88694, 88000]);
    const state = (await pool.query('select state from rss_response_state')).rows[0].state;
    expect(state.counters.responses).toBe(3);
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
    expect(await save(response(21, 19, 90))).toBe(0);
    expect((await pool.query('select state from rss_response_state')).rows[0].state.counters.rawComparisons).toBe(2);
  });
  test('concurrent duplicate responses commit one sample and one measurement', async () => {
    const r = response(18, 18, 100);
    const writes = await Promise.all([save(r), save(r)]);
    expect(writes.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await pool.query('select state from rss_response_state')).rows[0].state.counters.responses).toBe(1);
  });
  test('a multi-channel batch filters stale counts without losing another channel’s correction', async () => {
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
    ], [stale, correction])).toBe(1);
    expect((await pool.query("select views::int from rss_samples where video_id='second' order by at")).rows.map(r => r.views)).toEqual([200, 190]);
  });
  test('legacy pending samples without headers retain replay compatibility', async () => {
    expect(await saveRssObservations(pool, [{ video_id: 'legacy', at: '2026-09-07T10:00:00Z', views: 10, likes: 0 }], [])).toBe(1);
  });
});
