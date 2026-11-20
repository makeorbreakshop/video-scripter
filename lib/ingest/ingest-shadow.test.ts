import { shadowWrites } from './ingest-shadow';

describe('ingest shadow write', () => {
  it('never fails the import: a local error is reported, not thrown', async () => {
    const broken = { connect: async () => { throw new Error('ECONNREFUSED 127.0.0.1:5434'); } };
    const r = await shadowWrites(broken as never, [{ sql: 'select 1', params: [] }]);
    expect(r).toMatchObject({ ok: false, rows: 0 });
    expect(r.error).toMatch(/ECONNREFUSED/);
  });
  it('rolls the whole video back when one statement fails, so local never holds half an import', async () => {
    const sent: string[] = [];
    const client = { query: async (sql: string) => { sent.push(sql); if (sql === 'bad') throw new Error('boom'); return { rowCount: 1 }; }, release: () => {} };
    const r = await shadowWrites({ connect: async () => client } as never, [{ sql: 'good', params: [] }, { sql: 'bad', params: [] }]);
    expect(r.ok).toBe(false);
    expect(sent).toEqual(['begin', 'good', 'bad', 'rollback']);
  });
  it('skips an empty list without touching the database', async () => {
    const untouchable = { connect: async () => { throw new Error('touched'); } };
    expect(await shadowWrites(untouchable as never, [])).toEqual({ ok: true, rows: 0 });
  });
});
