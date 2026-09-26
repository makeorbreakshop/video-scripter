// The partition migration and the nightly partition maintenance, run for real against a
// TEMPORARY clone of video_score_history holding a copy of its live rows. Temp tables are private
// to this session and vanish with it: production objects are only read.
//
// Opt-in: ALLOW_PRODUCTION_INTEGRATION_TESTS=1 npx jest --testPathIgnorePatterns /node_modules/ -- lib/readings/history-partitions.integration.test.ts
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { CATALOG_SIZES_SQL, rowToRelation } from '../ops/storage-contract';
import {
  partitionMigrationSql, createPartitionSql, dropPartitionSql, partitionDays, type HistoryTable,
} from './history-partitions';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
// Session pooler: temp objects must live on one backend across statements.
const DSN = process.env.DATABASE_SESSION_URL;
const maybe = process.env.ALLOW_PRODUCTION_INTEGRATION_TESTS === '1' && DSN ? describe : describe.skip;

const CLONE: HistoryTable = {
  schema: 'pg_temp', table: 'vsh_clone', view: 'vsh_clone_by_version', sequence: 'vsh_clone_id_seq', extraGrants: [],
};

maybe('partitioning a clone of video_score_history', () => {
  let client: pg.Client;
  let copied = 0;
  let migrationMs = 0;
  beforeAll(async () => {
    client = new pg.Client({ connectionString: DSN });
    await client.connect();
    await client.query(`set statement_timeout = '300s'`);
    await client.query(`create temp sequence vsh_clone_id_seq`);
    await client.query(`create temp table vsh_clone (like public.video_score_history including defaults)`);
    await client.query(`alter table vsh_clone alter column id set default nextval('vsh_clone_id_seq')`);
    await client.query(`alter table vsh_clone add primary key (id)`);
    // The real live set (~200 K rows, ~90 MB), copied server-side — nothing comes to the client.
    copied = (await client.query(`insert into vsh_clone select * from public.video_score_history`)).rowCount ?? 0;
    await client.query(`create temp view vsh_clone_by_version as select distinct on (video_id, model_version) * from vsh_clone order by video_id, model_version, scored_at desc`);
    const t0 = Date.now();
    await client.query(partitionMigrationSql(CLONE));
    migrationMs = Date.now() - t0;
    console.log(`migration of ${copied} rows on the clone: ${migrationMs} ms`);
  }, 600_000);
  afterAll(async () => { await client?.end(); });

  const rel = async (name: string) => (await client.query(
    `select c.relkind from pg_class c where c.oid = to_regclass($1)`, [name])).rows[0]?.relkind ?? null;

  it('swapped in a partitioned table with every row, and kept the old one for rollback', async () => {
    expect(copied).toBeGreaterThan(1000);
    expect(await rel('pg_temp.vsh_clone')).toBe('p');
    expect(await rel('pg_temp.vsh_clone_unpartitioned')).toBe('r');
    const [{ n }] = (await client.query(`select count(*)::int as n from vsh_clone`)).rows;
    expect(n).toBe(copied);
    const [{ d }] = (await client.query(`select count(*)::int as d from vsh_clone_default`)).rows;
    expect(d).toBe(0);
  });

  it('put each row in its own UTC day partition', async () => {
    const [{ bad }] = (await client.query(`
      select count(*)::int as bad from vsh_clone h
        join pg_class c on c.oid = h.tableoid
       where c.relname <> 'vsh_clone_p' || to_char((h.scored_at at time zone 'utc')::date, 'YYYYMMDD')`)).rows;
    expect(bad).toBe(0);
  });

  it('keeps the id sequence and the default, so the scorer insert path is unchanged', async () => {
    const r = await client.query(`insert into vsh_clone (video_id, model_version) values ('zzPartTest', 'test') returning id, scored_at`);
    expect(Number(r.rows[0].id)).toBeGreaterThan(0);
  });

  it('the dependent view reads the new table', async () => {
    const [{ n }] = (await client.query(`select count(*)::int as n from vsh_clone_by_version where video_id = 'zzPartTest'`)).rows;
    expect(n).toBe(1);
  });

  it('nightly maintenance: create ahead, drop an expired day, and the rows go with it', async () => {
    const future = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    await client.query(createPartitionSql(CLONE, future));
    await client.query(createPartitionSql(CLONE, future)); // idempotent
    const names = (await client.query(
      `select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'pg_temp.vsh_clone'::regclass`)).rows.map((r) => r.relname);
    const days = partitionDays(names);
    expect(days).toContain(future);
    const oldest = days[0];
    const [{ before }] = (await client.query(`select count(*)::int as before from vsh_clone`)).rows;
    const [{ inDay }] = (await client.query(
      `select count(*)::int as "inDay" from vsh_clone where scored_at >= $1::date and scored_at < $1::date + 1`, [oldest])).rows;
    await client.query(dropPartitionSql(CLONE, oldest));
    const [{ after }] = (await client.query(`select count(*)::int as after from vsh_clone`)).rows;
    expect(after).toBe(before - inDay);
  });

  it('the storage contract sees ONE table, with its partitions rolled up into it', async () => {
    const rows = (await client.query(CATALOG_SIZES_SQL)).rows.map(rowToRelation);
    const mine = rows.filter((r) => /\.vsh_clone/.test(r.name));
    const parent = mine.find((r) => r.name.endsWith('.vsh_clone'));
    expect(parent).toMatchObject({ kind: 'p' });
    expect(parent!.totalBytes).toBeGreaterThan(10 * 1024 * 1024);
    expect(mine.filter((r) => /_p\d{8}$|_default$/.test(r.name))).toEqual([]);
  });

  it('the migration is quick at today\'s size', () => {
    // Writers are blocked for this long; readers are not. Reported in the runbook.
    expect(migrationMs).toBeLessThan(120_000);
  });
});
