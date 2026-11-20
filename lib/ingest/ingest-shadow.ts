// U5a of docs/plans/2026-11-20-local-pipeline-db.md: touch-drain's import of a new video, run
// against the local pipeline DB first — the video row into the local replica, then its first
// view_samples / view_snapshots rows. This is where new videos come from, so it also keeps the
// local replica current instead of up to a day behind the export mirror. One transaction (never
// half an import), idempotent, and it never throws: Supabase stays the write the job depends on.
import type pg from 'pg';
import type { PipelinePool } from '../db/pipeline';
import type { ShadowResult } from '../rss/pipeline-shadow';
import type { Write } from './first-sample';

export async function shadowWrites(pool: PipelinePool, writes: Write[]): Promise<ShadowResult> {
  if (!writes.length) return { ok: true, rows: 0 };
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('begin');
    let rows = 0;
    for (const w of writes) rows += (await client.query(w.sql, w.params)).rowCount ?? 0;
    await client.query('commit');
    return { ok: true, rows };
  } catch (e) {
    await client?.query('rollback').catch(() => {});
    return { ok: false, rows: 0, error: (e as Error).message };
  } finally {
    client?.release();
  }
}
