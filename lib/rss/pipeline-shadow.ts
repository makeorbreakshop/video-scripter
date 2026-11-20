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
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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

// ---- local first (2026-11-20) --------------------------------------------------------------
//
// The local DB is the system of record, so a chunk is written there BEFORE Supabase. A Supabase
// 57014 then no longer loses the readings: they are already local, and only the Supabase copy
// waits in the pending journal (and, after MAX_REPLAY_ATTEMPTS, in a quarantine file).
//
// Each chunk is written locally ONCE. Local response state has already advanced past it, so a
// second local write would look like a replayed response and downgrade its readings to
// model_eligible = false (INSERT_TIMED_RSS_SQL's conflict rule). The ledger remembers which
// chunks local holds, by content, across the ticks that retry the Supabase side.

export interface ShadowLedger { has(key: string): boolean; add(key: string): void }

/** Content key: order-independent, unlike pending-replay's chunkId (row count + first id). */
export function shadowChunkKey(chunk: ShadowChunk): string {
  const samples = chunk.samples.map((s) => `${s.video_id}|${s.at}|${s.views ?? ''}|${s.likes ?? ''}`).sort();
  const responses = chunk.responses.map((r) => `${r.channelId}|${r.fetchedAt}`).sort();
  return createHash('sha256').update(samples.join('\n')).update('\0').update(responses.join('\n')).digest('hex');
}

export async function writeChunkBoth<R>(args: {
  id: string; ledger: ShadowLedger;
  local: () => Promise<ShadowResult>;
  remote: () => Promise<R>;
}): Promise<{ local: ShadowResult & { skipped?: string }; remote: R }> {
  let local: ShadowResult & { skipped?: string };
  if (args.ledger.has(args.id)) local = { ok: true, rows: 0, skipped: 'already-local' };
  else {
    local = await args.local();
    if (local.ok) args.ledger.add(args.id);
  }
  // Supabase failure propagates unchanged: the pending journal and quarantine still own it.
  const remote = await args.remote();
  return { local, remote };
}

/** JSON file of key -> first-written epoch ms; entries older than maxAgeMs are dropped on load. */
export class FileShadowLedger implements ShadowLedger {
  private seen: Record<string, number>;
  constructor(private file: string, private now: () => number = Date.now, private maxAgeMs = 7 * 86_400_000) {
    let raw: Record<string, number> = {};
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run or unreadable: start empty */ }
    const cutoff = this.now() - this.maxAgeMs;
    this.seen = Object.fromEntries(Object.entries(raw).filter(([, t]) => t >= cutoff));
  }
  has(key: string): boolean { return key in this.seen; }
  add(key: string): void {
    this.seen[key] = this.now();
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.seen));
    fs.renameSync(tmp, this.file);
  }
}
