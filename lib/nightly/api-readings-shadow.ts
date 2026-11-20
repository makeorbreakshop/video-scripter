// U5a of docs/plans/2026-11-20-local-pipeline-db.md: API readings (view_samples, view_snapshots)
// written into the local pipeline database FIRST, before the Supabase transaction, by the two
// scheduled API writers (launch-track via writeSampleBatch, track-due). Local is the system of
// record, so a Supabase timeout no longer loses the reading there.
//
// Unlike the RSS shadow there is no ledger: these writes are plain idempotent upserts (a retried
// batch rewrites the same values), with no response-state rules that a second write could change.
// Only readings move; track_schedule and view_tracking_priority stay on Supabase until U5b.
// The shadow never throws; it is gated by the same PIPELINE_SHADOW flag as rss-poll.
import type pg from 'pg';
import { sampleBatchPayload, SAMPLE_INSERT_SQL, SNAPSHOT_UPSERT_SQL, type SampleWrite } from './sample-batch';
import type { ShadowResult } from '../rss/pipeline-shadow';
import type { PipelinePool } from '../db/pipeline';

export async function shadowSampleBatch(pool: PipelinePool, rows: SampleWrite[]): Promise<ShadowResult> {
  if (!rows.length) return { ok: true, rows: 0 };
  let client: pg.PoolClient | null = null;
  try {
    client = await pool.connect();
    const payload = sampleBatchPayload(rows);
    await client.query('begin');
    const r = await client.query(SAMPLE_INSERT_SQL, [payload]);
    await client.query(SNAPSHOT_UPSERT_SQL, [payload]);
    await client.query('commit');
    return { ok: true, rows: r.rowCount ?? 0 };
  } catch (e) {
    await client?.query('rollback').catch(() => {});
    return { ok: false, rows: 0, error: (e as Error).message };
  } finally {
    client?.release();
  }
}

export interface DueSnapshotWrite {
  video_id: string; snapshot_date: string; view_count: number; like_count: number | null;
  comment_count: number | null; days_since_published: number | null; daily_views_rate: number | null;
}

/**
 * track-due's day snapshot, same rule as its Supabase statement: an API reading overwrites a
 * same-day RSS reading (upsert = true); an RSS reading never overwrites an API one (do nothing).
 */
export async function shadowDueSnapshots(pool: PipelinePool, rows: DueSnapshotWrite[], upsert: boolean): Promise<ShadowResult> {
  if (!rows.length) return { ok: true, rows: 0 };
  try {
    const r = await pool.query(
      `insert into view_snapshots (video_id, snapshot_date, view_count, like_count, comment_count, days_since_published, daily_views_rate)
       select video_id, snapshot_date, view_count, like_count, comment_count, days_since_published, daily_views_rate
         from jsonb_to_recordset($1::jsonb) as x(video_id text, snapshot_date date, view_count integer, like_count integer,
              comment_count integer, days_since_published integer, daily_views_rate double precision)
        order by video_id collate "C"
       on conflict (video_id, snapshot_date) do ${upsert
         ? `update set view_count = excluded.view_count, like_count = excluded.like_count,
                      comment_count = excluded.comment_count, daily_views_rate = excluded.daily_views_rate`
         : 'nothing'}`,
      [JSON.stringify(rows.map((x) => ({ ...x, snapshot_date: String(x.snapshot_date).slice(0, 10) })))]);
    return { ok: true, rows: r.rowCount ?? 0 };
  } catch (e) {
    return { ok: false, rows: 0, error: (e as Error).message };
  }
}
