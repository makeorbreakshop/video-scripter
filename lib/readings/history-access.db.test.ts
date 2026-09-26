// video_score_history is written and read only over direct Postgres (lib/scoring/history.ts,
// scripts/thin-readings.ts, archive, scorecard, semantic scripts) as roles that bypass RLS. Until
// 2026-09-26 it had RLS off and granted anon/authenticated full DML, so anyone with the public anon
// key could rewrite or delete score history through PostgREST. This pins the locked-down state.
//
// Opt-in: ALLOW_PRODUCTION_INTEGRATION_TESTS=1 npx jest --testPathIgnorePatterns /node_modules/ -- lib/readings/history-access.db.test.ts
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
const DSN = process.env.DATABASE_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;

maybe('video_score_history is closed to the public API roles', () => {
  let rows: { rel: string; kind: string; rls: boolean; anon: boolean; auth: boolean }[] = [];
  beforeAll(async () => {
    const pool = new pg.Pool({ connectionString: DSN, max: 1 });
    try {
      rows = (await pool.query(`
        select c.relname as rel, c.relkind as kind, c.relrowsecurity as rls,
               has_table_privilege('anon', c.oid, 'select,insert,update,delete') as anon,
               has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') as auth
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
           and (c.relname = 'video_score_history' or c.relname like 'video_score_history\\_p%'
                or c.relname = 'video_score_history_default' or c.relname = 'video_scores_by_version')`)).rows;
    } finally { await pool.end(); }
  });

  it('covers the parent, its partitions and the view', () => {
    expect(rows.length).toBeGreaterThan(5);
  });

  it('grants anon and authenticated nothing', () => {
    expect(rows.filter((r) => r.anon || r.auth).map((r) => r.rel)).toEqual([]);
  });

  it('has row level security on every table (the view runs as its owner, so it is closed by grants)', () => {
    expect(rows.filter((r) => r.kind !== 'v' && !r.rls).map((r) => r.rel)).toEqual([]);
  });
});
