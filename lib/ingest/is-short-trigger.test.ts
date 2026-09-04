// The database must NOT decide is_short. lib/ingest/classify.ts settles a 63-180s "clip" against
// YouTube's own /shorts/<id> routing and writes the verdict with shorts_checked_at = now();
// a BEFORE INSERT/UPDATE trigger that recomputes is_short from duration silently discards it.
// (2026-09-04: `trigger_set_video_is_short` did exactly that — 68% of the re-checked
// 61-180s band was long-form, wrongly stored as Shorts and dropped from every baseline.)
//
// This is an integration test: it needs DATABASE_URL (.env.local) and writes inside a
// transaction that is always rolled back. It is skipped when no DATABASE_URL is present.
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const DSN = process.env.DATABASE_URL;
const maybe = DSN ? describe : describe.skip;

maybe('videos.is_short is never overwritten by the database', () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: DSN, max: 1 }); });
  afterAll(async () => { await pool?.end(); });

  const TEST_ID = 'zzTRIGGERTST';

  it('keeps a routing-verified 120s long-form insert at is_short = false', async () => {
    const c = await pool.connect();
    try {
      await c.query('set statement_timeout = 30000');
      await c.query('begin');
      const seed = (await c.query(
        `select channel_id, user_id from videos where channel_id is not null limit 1`)).rows[0];
      expect(seed).toBeTruthy();
      await c.query(
        `insert into videos (id, channel_id, title, description, duration, published_at,
                             view_count, user_id, is_short, shorts_checked_at)
         values ($1, $2, 'trigger guard fixture', 'no hashtags here', 'PT2M0S', now(), 100, $3,
                 false, now())`,
        [TEST_ID, seed.channel_id, seed.user_id]);
      const ins = (await c.query(
        `select is_short, shorts_checked_at from videos where id = $1`, [TEST_ID])).rows[0];
      expect(ins.is_short).toBe(false);
      expect(ins.shorts_checked_at).not.toBeNull();

      // A later title edit must not re-fire a duration rule either.
      await c.query(`update videos set title = 'trigger guard fixture v2' where id = $1`, [TEST_ID]);
      const upd = (await c.query(`select is_short from videos where id = $1`, [TEST_ID])).rows[0];
      expect(upd.is_short).toBe(false);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  }, 60000);

  it('has no trigger on videos that touches is_short', async () => {
    const { rows } = await pool.query(
      `select t.tgname, pg_get_triggerdef(t.oid) def
         from pg_trigger t
        where t.tgrelid = 'public.videos'::regclass and not t.tgisinternal`);
    const offenders: string[] = [];
    for (const r of rows) {
      const fn = /EXECUTE (?:PROCEDURE|FUNCTION) ([^(]+)\(/.exec(r.def)?.[1]?.trim();
      if (!fn) continue;
      const src = (await pool.query(`select pg_get_functiondef($1::regproc) d`, [fn])).rows[0].d as string;
      if (/\bNEW\.is_short\s*:=/i.test(src) || /\bis_youtube_short\s*\(/i.test(src)) offenders.push(r.tgname);
    }
    expect(offenders).toEqual([]);
  }, 60000);
});
