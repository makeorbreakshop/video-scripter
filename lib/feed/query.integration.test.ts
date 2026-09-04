// The feed page must stay fast for the largest real account. Brandon tracks 500 channels;
// the shapes in lib/feed/query.ts were chosen from measurements against exactly this data
// (docs/perf/2026-09-04-feed-speed-audit.md), and a plan regression here is invisible in the
// unit tests because those mock the database away.
//
// Integration test: it needs DATABASE_URL (.env.local) and only reads. Skipped without one.
// The budget is deliberately loose — it is a guard against an order-of-magnitude regression
// (the lateral shape read ~12,700 buffers for this account and could take seconds cold), not
// a benchmark of the network between here and Supabase.
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const DSN = process.env.DATABASE_URL;
const maybe = DSN ? describe : describe.skip;

const BUDGET_MS = 1500;
const BUFFER_BUDGET = 8000; // the 500-channel default view measured 1,331 after the change

maybe('the feed loads fast for a 500-channel account', () => {
  let pool: pg.Pool;
  let channelIds: string[] = [];
  let feedForChannels: typeof import('./query').feedForChannels;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DSN, max: 2 });
    const { rows } = await pool.query(
      `select uc.channel_id
         from user_channels uc
         join (select user_id from user_channels group by user_id order by count(*) desc limit 1) top
           on top.user_id = uc.user_id`
    );
    channelIds = rows.map((r) => r.channel_id);
    ({ feedForChannels } = await import('./query'));
    await feedForChannels(channelIds, { limit: 60 }); // warm the connection, not the plan
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    const { getPool } = await import('../admin/db');
    await getPool().end().catch(() => {});
  });

  it('has a large enough account to be worth measuring', () => {
    expect(channelIds.length).toBeGreaterThan(100);
  });

  it.each([
    ['default', undefined],
    ['uploads', ['upload']],
    ['tests', ['ab_rotation', 'thumbnail_change']],
    ['outliers', ['outlier']],
  ] as const)('loads the %s view in under %s', async (_name, types) => {
    const started = Date.now();
    const page = await feedForChannels(channelIds, { limit: 60, types: types ? [...types] : null });
    expect(Date.now() - started).toBeLessThan(BUDGET_MS);
    expect(page.events.length).toBeGreaterThan(0);
  }, 30_000);

  it('pages by keyset without getting slower', async () => {
    let cursor: string | null = null;
    for (let i = 0; i < 3; i++) {
      const started = Date.now();
      const page: Awaited<ReturnType<typeof feedForChannels>> =
        await feedForChannels(channelIds, { limit: 60, cursor });
      expect(Date.now() - started).toBeLessThan(BUDGET_MS);
      cursor = page.next_cursor;
      if (!cursor) break;
    }
  }, 60_000);

  it('reads a bounded number of buffers for the default view', async () => {
    // The measurement that actually matters: this database has had IO incidents, and the
    // shape that reads ten times the pages is the one that takes the site down, not the one
    // that is a few milliseconds slower on a warm cache.
    const { rows } = await pool.query(
      `explain (analyze, buffers, format json)
         select e0.id from feed_events e0
          where e0.channel_id = any($1::text[]) and e0.is_longform
          order by e0.at desc, e0.id desc limit 61`,
      [channelIds]
    );
    const plan = rows[0]['QUERY PLAN'][0].Plan;
    const buffers = (plan['Shared Hit Blocks'] || 0) + (plan['Shared Read Blocks'] || 0);
    expect(buffers).toBeLessThan(BUFFER_BUDGET);
  }, 30_000);
});
