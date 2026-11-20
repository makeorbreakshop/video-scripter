// U4a of docs/plans/2026-11-20-local-pipeline-db.md: rss-poll's shadow write into the local
// pipeline database.
//
// Supabase stays the write rss-poll depends on until the observation jobs move (U6): the
// materializer, scoring and series rebuild still read rss_samples there. Each chunk that commits
// on Supabase is then written, unchanged, into the local database through the same code path
// (saveRssObservations), so the local copy is live and its triggers fill the local queues.
//
// The shadow can never fail a tick or hold polling back. A missed chunk is a gap that
// `scripts/pipeline-load.ts tail --from <day>` refills and `parity` reports.
import type pg from 'pg';
import { saveRssObservations, type RssSampleWrite } from './response-store';
import type { FeedResponse } from './response-freshness';
import type { StateCache } from './response-state-cache';

export function shadowEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PIPELINE_SHADOW === '1';
}

export interface ShadowChunk { samples: RssSampleWrite[]; responses: FeedResponse[] }
export type ShadowResult = { ok: boolean; rows: number; error?: string };

export async function shadowSave(pool: pg.Pool, chunk: ShadowChunk, stateCache?: StateCache): Promise<ShadowResult> {
  if (!chunk.samples.length && !chunk.responses.length) return { ok: true, rows: 0 };
  try {
    // rememberCandidates: false. The Supabase write already registered these readings with the
    // observation-candidate cache; a second put from the shadow would double them.
    const rows = await saveRssObservations(pool, chunk.samples, chunk.responses, stateCache, { rememberCandidates: false });
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, rows: 0, error: (e as Error).message };
  }
}
