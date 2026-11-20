// Channel RSS poller — the free lane's "when did it change?" detector. ZERO Data API quota.
// Plan: docs/plans/2026-09-03-two-lane-watcher.md section 1. Policy (pure, tested) lives in
// lib/rss/poll-policy.ts and lib/rss/title-change.ts; this file is I/O only.
//
// A tick is four phases, and NO phase interleaves network with database work:
//
//   1. SELECT   which channels are due (one query).
//   2. FETCH    every due feed concurrently. Zero DB calls inside this loop.
//   3. SNAPSHOT one set-based read of everything the diff needs, keyed on the video ids the
//               feeds actually mentioned: current title, latest description hash, latest
//               title_versions version, video_title_watch.title_observed_at, latest thumbnail last_checked.
//   4. DIFF + FLUSH   diff entirely in memory, then write each table once in ~5K chunks.
//
// Why: the previous shape did a burst of set-based statements PER CHANNEL, inside the fetch
// loop. Measured 2026-09-03 at full corpus, that was ~0.40 s/channel — 1,935 channels took
// 474-518 s and 950 took 376-390 s, all overrunning the 300 s LaunchAgent interval.
//
// Durability: if the flush fails, the whole buffer is written to logs/rss-poll-pending.ndjson
// and the NEXT tick replays it before fetching anything, in bounded chunks with progress saved
// after each one (lib/rss/pending-replay.ts). A chunk that fails MAX_REPLAY_ATTEMPTS ticks in a
// row is quarantined and polling resumes: a single poison buffer blocked all polling for 11 days
// (2026-09-11 → 09-22) when the replay was one statement that failed closed forever.
//
// MEASURED 2026-09-03: this feed sends no ETag and no Last-Modified, so the conditional-request
// path never fires. "Unchanged" is decided by hashing the body (rss_body_sha), which skips the
// used to skip the whole diff. Identical bodies now still refresh heartbeat/title evidence.
//
// Direct Postgres only (2026-08-31 egress rule).
// Usage: npx tsx scripts/rss-poll.ts [maxChannels] [--subset] [--dry] [--seed]
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { chunk } from '../lib/nightly/tracking-core';
import { archiveResponses } from '../lib/rss/response-archive';
import { saveRssObservations } from '../lib/rss/response-store';
import { DiskStateCache } from '../lib/rss/response-state-cache';
import { SNAPSHOT_TRIAGE_SQL, Triage, triageParams, type TriageEntry } from '../lib/rss/snapshot-triage';
import type { FeedResponse, ResponseEvidence } from '../lib/rss/response-freshness';
import { withDeadlockRetry } from '../lib/nightly/pg-retry';
import { reenter } from '../lib/nightly/launch-core';
import { startManagedJob } from '../lib/nightly/job-lifecycle';
import { classifyTitleDiff, titleVersionPlan, TITLE_WATCH_UPSERT_SQL } from '../lib/rss/title-change';
import { markSeriesDirty } from '../lib/readings/series-store';
import { VIDEO_TEXT_JOIN } from '../lib/app/video-text';
import { pipelinePool, closePipelinePool } from '../lib/db/pipeline';
import { shadowEnabled, shadowSave, shadowChunks, FileShadowLedger } from '../lib/rss/pipeline-shadow';
import {
  emptyBuffers, mergeBuffers, planReplay, rowCount, chunkId, afterFailure,
  quarantineName, MAX_REPLAY_ATTEMPTS, REPLAY_MAX_SAMPLES, type Buffers, type ReplayAttempts,
} from '../lib/rss/pending-replay';
import {
  RSS_POLICY,
  parseRssEntries,
  backoffAfter,
  perRunCap,
  isUpdatedSince,
  hasFeedBodyChanged,
  isNewUpload,
  unknownEntryPlan,
  shouldStoreSample,
  SAMPLE_HEARTBEAT_MS,
  rssSamplesEnabled,
  completedChannelRows,
  LAST_SAMPLES_SQL,
  SEED_SUBSET_SQL,
  SEED_ALL_SQL,
  DUE_CHANNELS_SQL,
  STATE_COUNTS_SQL,
  type RssState,
  type RssEntry,
} from '../lib/rss/poll-policy';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const subset = args.includes('--subset') || process.env.WATCH_SUBSET === '1';
const forceSeed = args.includes('--seed');
const maxChannels = parseInt(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--max-seconds') || '0', 10) || null;
const job = dry ? { acquired: true, signal: new AbortController().signal, finish: () => {} } : startManagedJob({ name: 'rss-poll', args });
if (!job.acquired) process.exit(0);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
// pgbouncer strips startup options, so SET per connection like the other batch scripts.
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 120000').catch(() => {}); });
const now = new Date();
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const secs = (from: number) => ((Date.now() - from) / 1000).toFixed(1);
const PENDING = path.join(process.cwd(), 'logs', 'rss-poll-pending.ndjson');
/** Rows per INSERT. 5K keeps each statement well under the pooler's parameter ceiling. */
const CHUNK = 5000;
// ---------------------------------------------------------------- buffers

const empty = emptyBuffers;
// Local rss_response_state copies, versioned by the server's md5: the state read returns jsonb
// only for channels whose state changed elsewhere (was ~2.2 KB per polled channel per tick).
const RESPONSE_STATE_CACHE = new DiskStateCache(path.join(process.cwd(), '.cache', 'rss-response-state'));
// U4a (docs/plans/2026-11-20-local-pipeline-db.md): with PIPELINE_SHADOW=1 every chunk that
// commits on Supabase is also written to the local pipeline database. Its own state cache,
// because the versions are each database's md5 of its own row.
const SHADOW = shadowEnabled() ? pipelinePool() : null;
const SHADOW_STATE_CACHE = new DiskStateCache(path.join(process.cwd(), '.cache', 'rss-response-state-pipeline'));
const SHADOW_LEDGER = new FileShadowLedger(path.join(process.cwd(), 'logs', 'rss-poll-shadow-ledger.json'));
const shadowTotals = { chunks: 0, rows: 0, skipped: 0, failed: 0 };

// ---------------------------------------------------------------- flush

/** Cumulative ms per flush step this process; logged when a flush is slow. */
const flushMs: Record<string, number> = {};
async function flush(b: Buffers): Promise<Record<string, number>> {
  const written: Record<string, number> = {};
  // Sort every buffer on its key before writing: the deterministic order is half of the
  // deadlock fix (lib/nightly/pg-retry is the other half).
  const byId = (a: { video_id: string }, z: { video_id: string }) => (a.video_id < z.video_id ? -1 : a.video_id > z.video_id ? 1 : 0);
  b.samples.sort(byId); b.titleVersions.sort(byId); b.videoTitles.sort(byId);
  b.descVersions.sort(byId); b.dueNow.sort(byId);
  b.observed.sort(); b.reentries.sort(); b.titleChecks.sort();
  b.touchQueue.sort((a, z) => (a.ref < z.ref ? -1 : a.ref > z.ref ? 1 : 0));
  b.channels.sort((a, z) => (a.channel_id < z.channel_id ? -1 : a.channel_id > z.channel_id ? 1 : 0));
  // Duplicates across channels are impossible for videos, but a defensive dedupe on the stamp
  // lists keeps the arrays (and the lock set) as small as possible.
  b.observed = [...new Set(b.observed)];
  b.titleChecks = [...new Set(b.titleChecks)];
  // `actual` counts what the statement really wrote (via RETURNING) instead of what we offered.
  // touch_queue needs it: most ids we re-offer are already queued from an earlier tick, and
  // reporting the offered count as "new videos queued" overstates discovery by ~5x.
  const insert = async (name: string, sql: string, rows: any[], cols: (r: any) => any[], actual = false) => {
    if (!rows.length) return;
    let n = 0;
    const ts = Date.now();
    for (const part of chunk(rows, CHUNK)) {
      // Deterministic lock order + retry: launch-track, the drainer and this poller all write
      // videos/track_schedule, and two statements taking overlapping ids in different orders
      // deadlock (observed 40P01 on the first full-corpus flush).
      const res = await withDeadlockRetry(() => pool.query(sql, cols(part)));
      n += actual ? (res.rowCount ?? 0) : part.length;
    }
    written[name] = (written[name] ?? 0) + n;
    flushMs[name] = (flushMs[name] ?? 0) + Date.now() - ts;
  };

  const ts0 = Date.now();
  written['rss_samples'] = await saveRssObservations(pool, b.samples, b.responses, RESPONSE_STATE_CACHE);
  flushMs['rss_samples'] = (flushMs['rss_samples'] ?? 0) + Date.now() - ts0;
  // saveRssObservations queues the videos whose readings moved; a title change moves the
  // packaging markers the same chart draws, so those videos are queued here too.
  await markSeriesDirty(pool, b.titleVersions.map((r: any) => r.video_id));

  await insert('title_versions',
    `insert into title_versions (video_id, version, title, first_seen, backfill)
     select * from unnest($1::text[], $2::int[], $3::text[], $4::timestamptz[], $5::boolean[])
     on conflict do nothing`,
    b.titleVersions, (p) => [p.map((r: any) => r.video_id), p.map((r: any) => r.version), p.map((r: any) => r.title), p.map((r: any) => r.first_seen), p.map((r: any) => r.backfill)]);

  await insert('description_versions',
    `insert into description_versions (video_id, version, sha256, description, first_seen, backfill)
     select * from unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::timestamptz[], $6::boolean[])
     on conflict do nothing`,
    b.descVersions, (p) => [p.map((r: any) => r.video_id), p.map((r: any) => r.version), p.map((r: any) => r.sha256), p.map((r: any) => r.description), p.map((r: any) => r.first_seen), p.map((r: any) => r.backfill)]);

  await insert('touch_queue',
    `insert into touch_queue (kind, ref, source_url, mode)
     select 'video', * , 'websub' from unnest($1::text[], $2::text[])
     on conflict (kind, ref) do nothing
     returning 1`,
    b.touchQueue, (p) => [p.map((r: any) => r.ref), p.map((r: any) => r.source_url)], true);

  // Titles that moved. Set-based UPDATE ... FROM the incoming values.
  await insert('videos.title',
    `update videos v set title = x.title, updated_at = now()
       from unnest($1::text[], $2::text[]) as x(video_id, title)
      where v.id = x.video_id`,
    b.videoTitles, (p) => [p.map((r: any) => r.video_id), p.map((r: any) => r.title)]);

  // Every title we LOOKED at, changed or not — the evidence the CHANGE/SYNC rule reads next tick.
  // Since 2026-09-04 this lands in the narrow `video_title_watch` table, not on `videos`: stamping
  // a 45-index, 1.8 KB-row table every five minutes was 22 % of all execution on the instance
  // (sql/2026-09-04-video-title-watch.sql). The STAMP_MAX_AGE skip now lives in the shared
  // TITLE_WATCH_UPSERT_SQL. A title we CHANGED is an observation too, so its id is stamped here as
  // well — the diff phase only pushes unchanged ids onto b.observed.
  await insert('video_title_watch', TITLE_WATCH_UPSERT_SQL,
    [...new Set([...b.observed, ...b.videoTitles.map((r: any) => r.video_id)])].sort(),
    (p) => [p, now], true);

  await insert('track_schedule.reentry',
    `update track_schedule set phase = 'launch', launch_until = $2, next_check = $3,
            entered_reason = 'title_change', last_title_check = $3, updated_at = now()
      where video_id = any($1)`,
    b.reentries, (p) => { const r = reenter(now); return [p, r.launch_until, r.next_check]; });

  // video_title_watch is the sole title-observation evidence. The old schedule stamp
  // has no readers; writing it again costs a second row update for the same check.

  await insert('thumbnail_versions.due_now',
    `update thumbnail_versions t set last_checked = 'epoch'
       from unnest($1::text[], $2::int[]) as m(video_id, version)
      where t.video_id = m.video_id and t.version = m.version`,
    b.dueNow, (p) => [p.map((r: any) => r.video_id), p.map((r: any) => r.version)]);

  await insert('channel_rss_state',
    `update channel_rss_state c
        set rss_last_polled = $7, rss_last_status = x.status, rss_body_sha = coalesce(x.body_sha, c.rss_body_sha),
            rss_etag = x.etag, rss_interval_sec = x.interval_sec, rss_backoff_until = x.backoff_until,
            rss_state = case when x.clear_woken and c.rss_state = 'woken' then 'active' else c.rss_state end,
            updated_at = now()
       from unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::int[], $6::timestamptz[], $8::boolean[])
         as x(channel_id, status, body_sha, etag, interval_sec, backoff_until, clear_woken)
      where c.channel_id = x.channel_id`,
    b.channels, (p) => [p.map((r: any) => r.channel_id), p.map((r: any) => r.status), p.map((r: any) => r.body_sha),
                        p.map((r: any) => r.etag), p.map((r: any) => r.interval_sec), p.map((r: any) => r.backoff_until),
                        now, p.map((r: any) => r.clear_woken)]);
  return written;
}

const ATTEMPTS = path.join(process.cwd(), 'logs', 'rss-poll-pending.attempts');
/** rss_samples per flush statement set. Env override exists for measuring, not for tuning live. */
const REPLAY_SAMPLES = Number(process.env.RSS_FLUSH_SAMPLES) || REPLAY_MAX_SAMPLES;

/** Atomically replace the pending file with the chunks still to write (one chunk per line). */
function writePending(chunks: Buffers[]): void { writePendingLines(chunks.map((c) => JSON.stringify(c))); }
function writePendingLines(lines: string[]): void {
  if (!lines.length) { fs.rmSync(PENDING, { force: true }); return; }
  const tmp = `${PENDING}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, lines.join('\n') + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, PENDING);
}

function readAttempts(): ReplayAttempts | null {
  try { return JSON.parse(fs.readFileSync(ATTEMPTS, 'utf8')); } catch { return null; }
}

/**
 * Write whatever is in the pending file, in bounded chunks, persisting progress after each.
 * Used both to replay a buffer an earlier tick could not write and to flush this tick's own
 * buffer (journaled first): a full-cap tick carries ~39K rss_samples, and as ONE statement it
 * times out under the rss_samples statement trigger (2026-09-22 14:11 tick, measured).
 * Returns ok=true when polling may proceed (nothing left, or quarantined) and ok=false when a
 * chunk failed and will be retried next tick. Only that in-progress chunk holds polling back,
 * and only for MAX_REPLAY_ATTEMPTS ticks.
 */
async function drainPending(label: string): Promise<{ ok: boolean; written: Record<string, number> }> {
  const total: Record<string, number> = {};
  if (!fs.existsSync(PENDING)) { fs.rmSync(ATTEMPTS, { force: true }); return { ok: true, written: total }; }
  const text = fs.readFileSync(PENDING, 'utf8').trim();
  if (!text) { fs.rmSync(PENDING, { force: true }); fs.rmSync(ATTEMPTS, { force: true }); return { ok: true, written: total }; }
  const t = Date.now();
  let parsed: Partial<Buffers>[];
  try { parsed = text.split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
  catch (e) { return { ok: quarantine(`unparseable: ${(e as Error).message}`), written: total }; }
  const { chunks, staleLines } = planReplay(parsed, new Date(), REPLAY_SAMPLES);
  if (label === 'replay' || chunks.length > 1) {
    const all = mergeBuffers(chunks);
    log(`${label}: ${rowCount(all)} rows (${all.samples.length} rss_samples) in ${chunks.length} chunks` +
        (staleLines ? `; ${staleLines} stale line(s), so their channel state / videos.title / re-entries dropped` : ''));
  }
  const lines = chunks.map((c) => JSON.stringify(c));
  writePendingLines(lines); // normalized to one chunk per line before the first write
  if (SHADOW) {
    // Local first, all chunks, before the Supabase loop (lib/rss/pipeline-shadow.ts shadowChunks):
    // the readings are safe in the system of record however Supabase fares below. Already-local
    // chunks (a Supabase retry) are skipped by content key. Never throws.
    const st = await shadowChunks(chunks.map((c) => ({ samples: c.samples ?? [], responses: c.responses ?? [] })),
      SHADOW_LEDGER, (c) => shadowSave(SHADOW, c, SHADOW_STATE_CACHE));
    for (const k of ['chunks', 'rows', 'skipped', 'failed'] as const) shadowTotals[k] += st[k];
    for (const e of st.errors) console.error(`pipeline shadow (${label}): chunk not written locally: ${e}`);
  }
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    // Both replay and this tick's own flush stop between chunks at the run budget, so the tick
    // exits cleanly (summary printed) instead of being force-killed mid-chunk.
    if (job.signal.aborted) {
      log(`${label}: run budget reached after ${i}/${chunks.length} chunks; the rest stays pending`);
      return { ok: false, written: total };
    }
    try {
      const w = await flush(c);
      for (const [k, v] of Object.entries(w)) total[k] = (total[k] ?? 0) + v;
    } catch (e) {
      const msg = (e as Error).message;
      const d = afterFailure(readAttempts(), chunkId(c));
      console.error(`${label} chunk ${i + 1}/${chunks.length} failed (attempt ${d.attempts}/${MAX_REPLAY_ATTEMPTS}): ${msg}`);
      if (d.action === 'quarantine') return { ok: quarantine(msg), written: total };
      fs.writeFileSync(ATTEMPTS, JSON.stringify({ attempts: d.attempts, chunkId: chunkId(c), lastError: msg, lastAt: new Date().toISOString() }));
      log(`${label} progress: ${i}/${chunks.length} chunks, ${JSON.stringify(total)}; retrying next tick`);
      return { ok: false, written: total };
    }
    writePendingLines(lines.slice(i + 1)); // progress: a crash from here never re-flushes chunk i
    fs.rmSync(ATTEMPTS, { force: true });
  }
  if (label === 'replay') log(`replayed pending buffer in ${secs(t)}s, ${chunks.length} chunks: ${JSON.stringify(total)}`);
  return { ok: true, written: total };
}

function quarantine(reason: string): boolean {
  const dest = path.join(path.dirname(PENDING), quarantineName(new Date()));
  fs.renameSync(PENDING, dest);
  fs.rmSync(ATTEMPTS, { force: true });
  console.error(`!!! PENDING REPLAY QUARANTINED after ${MAX_REPLAY_ATTEMPTS} failed ticks: ${reason}. ` +
                `Moved to ${dest}; live polling continues. Replay it by moving it back to ${PENDING}.`);
  return true;
}

// ---------------------------------------------------------------- phase 0

if (!dry && (subset || forceSeed || now.getMinutes() < 5)) {
  const seeded = await pool.query(subset ? SEED_SUBSET_SQL : SEED_ALL_SQL);
  log(`seeded/refreshed ${seeded.rowCount} channel states${subset ? ' (subset)' : ''}`);
}

if (dry) {
  const { rows } = await pool.query(STATE_COUNTS_SQL, [subset]);
  console.log(`scope: ${subset ? 'watch_subset' : 'all channels'}`);
  console.log('state     total      due now');
  for (const s of ['active', 'woken', 'dormant']) {
    const r = rows.find((x: any) => x.rss_state === s);
    console.log(`${s.padEnd(10)}${String(r?.total ?? 0).padStart(6)}${String(r?.due ?? 0).padStart(13)}`);
  }
  const total = rows.reduce((a: number, r: any) => a + r.total, 0);
  console.log(`(per-run cap ${maxChannels ?? perRunCap(total)}, concurrency ${RSS_POLICY.concurrency}, tick ${RSS_POLICY.runIntervalSec}s)`);
  await pool.end();
  await closePipelinePool();
  job.finish();
  process.exit(0);
}

const replayStart = Date.now();
const replay = await drainPending('replay');
const budgetIdx = args.indexOf('--max-seconds');
const budgetSec = budgetIdx >= 0 ? Number(args[budgetIdx + 1]) || null : null;
const replaySecs = (Date.now() - replayStart) / 1000;
// A full tick needs ~150 s of fetch + snapshot before it writes anything (2026-09-22). Starting
// one after a long replay only gets it killed mid-snapshot, wasting every fetch; the channels
// stay due and the next tick polls them with the whole budget.
const tooLateToPoll = replay.ok && budgetSec != null && maxChannels == null && replaySecs > budgetSec * 0.35;
if (!replay.ok || tooLateToPoll) {
  if (tooLateToPoll) log(`replay used ${replaySecs.toFixed(0)}s of ${budgetSec}s; polling next tick`);
  process.exitCode = replay.ok ? 0 : 1;
  try {
    const { rows: sil } = await pool.query(`select round(extract(epoch from now() - max(at)) / 60)::int as m from rss_samples`);
    log(`rss_silence_minutes: ${sil[0]?.m ?? 'null'}`);
  } catch { /* the summary line is best-effort */ }
  await pool.end();
  await closePipelinePool();
  job.finish();
  process.exit(process.exitCode);
}

const { rows: totals } = await pool.query(
  `select count(*)::int as n from channel_rss_state c
    where (not $1::boolean or exists (select 1 from watch_subset w where w.channel_id = c.channel_id))`,
  [subset]
);
const cap = maxChannels ?? perRunCap(totals[0].n);
const { rows: due } = await pool.query(DUE_CHANNELS_SQL, [subset, cap]);
log(`polling ${due.length} of ${totals[0].n} channels (cap ${cap})`);

type DueChannel = {
  channel_id: string; rss_state: RssState; rss_etag: string | null;
  rss_body_sha: string | null; rss_interval_sec: number | null;
};

// ---------------------------------------------------------------- phase 1: fetch, no DB

const t0 = Date.now();
const buf = empty();
let ok200 = 0, notModified = 0, sameBody = 0, errors = 0;
interface Fetched { channel_id: string; entries: RssEntry[]; observedAt: Date; evidence: ResponseEvidence }
const fetched: Fetched[] = [];
const receipts: unknown[] = [];
const archiveName = `${now.getTime()}.jsonl.gz`;

// Fetch deadline: stop fetching once FETCH_BUDGET_SHARE of the run budget is spent, so the
// snapshot, diff and flush always get the rest. Unfetched channels are simply still due. Measured
// 2026-09-22 under heavy machine load: fetch 269 s for 2,648 feeds, then the snapshot was cut
// off and the whole tick wrote nothing — three ticks in a row.
const FETCH_BUDGET_SHARE = 0.45;
const fetchDeadline = budgetSec != null ? now.getTime() + budgetSec * FETCH_BUDGET_SHARE * 1000 : Infinity;
let fetchedGroups = 0;
for (const group of chunk(due as DueChannel[], RSS_POLICY.concurrency)) {
  if (job.signal.aborted) break;
  if (Date.now() > fetchDeadline) {
    log(`fetch deadline (${Math.round(budgetSec! * FETCH_BUDGET_SHARE)}s) reached after ${fetchedGroups * RSS_POLICY.concurrency} of ${due.length} channels; the rest stay due`);
    break;
  }
  fetchedGroups++;
  await Promise.all(group.map(async (c) => {
    let status = 0;
    let recorded = false;
    let responseHeaders: Record<string, string> = {};
    try {
      const headers: Record<string, string> = {};
      // Fetch the body even when unchanged: counts need a heartbeat and titles need evidence.
      // A 304 cannot prove the age of the counts carried by a prior response.
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channel_id}`, {
        headers, signal: AbortSignal.timeout(RSS_POLICY.timeoutMs),
      });
      status = res.status;
      responseHeaders = Object.fromEntries(res.headers);
      const body = await res.text();
      const observedAt = new Date();
      receipts.push({ channelId: c.channel_id, fetchedAt: observedAt.toISOString(),
        status, headers: responseHeaders, body });
      recorded = true;
      if (status === 304) {
        notModified++;
        buf.channels.push({ channel_id: c.channel_id, status: 304, body_sha: null, etag: c.rss_etag,
                            interval_sec: null, backoff_until: null, clear_woken: true });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${status}`);
      ok200++;
      const bodySha = sha(body);
      buf.channels.push({ channel_id: c.channel_id, status: 200, body_sha: bodySha,
                          etag: res.headers.get('etag'), interval_sec: null, backoff_until: null, clear_woken: true });
      if (!hasFeedBodyChanged(c.rss_body_sha, bodySha)) sameBody++;
      fetched.push({ channel_id: c.channel_id, entries: parseRssEntries(body), observedAt,
        evidence: { fetchedAt: observedAt.toISOString(), date: res.headers.get('date'),
          age: res.headers.get('age'), cacheControl: res.headers.get('cache-control'),
          archiveRef: `${archiveName}#${c.channel_id}:${observedAt.toISOString()}` } });
    } catch (err) {
      errors++;
      if (!recorded) receipts.push({ channelId: c.channel_id, fetchedAt: new Date().toISOString(),
        status: status || null, headers: responseHeaders, body: null, error: err instanceof Error ? err.message : String(err) });
      const b = backoffAfter(status || 599, c.rss_state, c.rss_interval_sec, now);
      buf.channels.push({ channel_id: c.channel_id, status: status || null, body_sha: null, etag: c.rss_etag,
                          interval_sec: b.intervalSec, backoff_until: b.backoffUntil ? b.backoffUntil.toISOString() : null,
                          clear_woken: false });
      console.error(`${c.channel_id}: ${err instanceof Error ? err.message : 'fetch error'}`);
    }
  }));
}
// Archive raw HTTP receipts before any database writes. Observation dedupe never deletes
// evidence; archive expiration is explicit and independent of chart history retention.
const archive = await archiveResponses(process.env.RSS_ARCHIVE_DIR || path.join(process.cwd(), 'logs/rss-responses'), now.getTime(), receipts);
log(`raw archive: ${archive.name}, ${archive.bytes} bytes; ${archive.expired.length} expired segments; ${archive.totalBytes} bytes retained${archive.overBudget ? '; WARNING newest segment exceeds archive budget' : ''}`);
const fetchSecs = secs(t0);
log(`fetch: ${fetchSecs}s — ${ok200} x 200 (${sameBody} identical body), ${notModified} x 304, ${errors} errors; ${fetched.length} feeds to diff`);

// ---------------------------------------------------------------- phase 2: one snapshot read

const t1 = Date.now();
const allIds = [...new Set(fetched.flatMap((f) => f.entries.map((e) => e.video_id)))];

interface Snap {
  title: string | null; description: string | null; published_at: Date | null;
  title_observed_at: Date | null;
  descVersion?: number; descSha?: string;
  titleMaxVersion?: number;
  thumbVersion?: number; thumbLastChecked?: Date;
  /** Triaged quiet (lib/rss/snapshot-triage.ts): every title/description/thumbnail branch is a no-op. */
  quiet?: boolean;
}
const snap = new Map<string, Snap>();
const lastSamples = new Map<string, { views: number | null; at: Date }>();
// Chunked so no single statement carries a 60K-element array.
let snapshotComplete = true;
// Triage first (lib/rss/snapshot-triage.ts, 2026-09-29): send what the feeds say, get back a row
// only for an entry that is unknown or may have changed. The full five-table read below then runs
// for title/description/thumbnail suspects only — it was ~253 B per feed id, ~9.8 MB a full tick.
const triage = new Triage();
const triageItems: TriageEntry[] = fetched.flatMap((f) => f.entries.map((entry) => ({ entry, observedAt: f.observedAt })));
// Four chunks at a time (the pool's size): each is index-bound, ~3.6 s per 5,000 entries cold.
for (const parts of chunk(chunk(triageItems, CHUNK), 4)) {
  if (job.signal.aborted) { snapshotComplete = false; break; }
  const results = await Promise.all(parts.map((part) =>
    pool.query(SNAPSHOT_TRIAGE_SQL, triageParams(part, sha, SAMPLE_HEARTBEAT_MS))));
  for (const r of results) triage.add(r.rows);
}
for (const [id, s] of triage.lastSamples) lastSamples.set(id, s);
for (const id of snapshotComplete ? triage.quietKnownIds(allIds) : []) {
  snap.set(id, { title: null, description: null, published_at: null, title_observed_at: null, quiet: true });
}
for (const part of chunk(snapshotComplete ? triage.fullReadIds() : [], CHUNK)) {
  // A partial snapshot is worse than none: a video missing from `snap` looks like an unknown id
  // and would be queued as a new upload, and its real title/description diff would be missed.
  if (job.signal.aborted) { snapshotComplete = false; break; }
  const [v, d, t, th, ls] = await Promise.all([
    // No description TEXT here: 3,500 multi-KB descriptions per chunk was ~10 GB/day of
    // egress (measured 2026-09-04). The hash is enough to diff; the text is fetched below only
    // for videos that still need their version-1 baseline row.
    pool.query(`select v.id, v.title, v.published_at, w.title_observed_at
                  from videos v left join video_title_watch w on w.video_id = v.id
                 where v.id = any($1)`, [part]),
    pool.query(`select distinct on (video_id) video_id, version, sha256 from description_versions
                 where video_id = any($1) order by video_id, version desc`, [part]),
    pool.query(`select video_id, max(version)::int as v from title_versions where video_id = any($1) group by video_id`, [part]),
    pool.query(`select distinct on (video_id) video_id, version, last_checked from thumbnail_versions
                 where video_id = any($1) order by video_id, version desc`, [part]),
    // The change-based rss_samples dedupe (shouldStoreSample). ONE set-based read per chunk,
    // in the snapshot phase — never a per-channel query inside the fetch loop.
    rssSamplesEnabled() ? pool.query(LAST_SAMPLES_SQL, [part]) : Promise.resolve({ rows: [] as any[] }),
  ]);
  for (const r of v.rows) snap.set(r.id, { title: r.title, description: null, published_at: r.published_at, title_observed_at: r.title_observed_at });
  for (const r of d.rows) { const s = snap.get(r.video_id); if (s) { s.descVersion = r.version; s.descSha = r.sha256; } }
  // Baseline text only for videos with no description_versions row yet (rare after the first pass).
  const needText = v.rows.filter((r: any) => !d.rows.some((x: any) => x.video_id === r.id)).map((r: any) => r.id);
  if (needText.length) {
    // Through the side table (lib/app/video-text.ts): correct before and after videos.description is cleared.
    const tx = await pool.query(`select v.id, coalesce(vt.description, v.description) as description
                                   from videos v ${VIDEO_TEXT_JOIN} where v.id = any($1)`, [needText]);
    for (const r of tx.rows) { const s = snap.get(r.id); if (s) s.description = r.description; }
  }
  for (const r of t.rows) { const s = snap.get(r.video_id); if (s) s.titleMaxVersion = r.v; }
  for (const r of th.rows) { const s = snap.get(r.video_id); if (s) { s.thumbVersion = r.version; s.thumbLastChecked = r.last_checked; } }
  for (const r of ls.rows) lastSamples.set(r.video_id, { views: r.views == null ? null : Number(r.views), at: r.at });
}
const snapSecs = secs(t1);
if (!snapshotComplete) log('snapshot aborted mid-way; skipping the diff so no feed is half-read');
log(`snapshot: ${snapSecs}s — ${allIds.length} feed video ids, ${snap.size} already in the corpus`);

// ---------------------------------------------------------------- phase 3: diff, in memory

const t2 = Date.now();
// Feed view samples are ON by default (they are the 15-minute readings past the launch window); RSS_SAMPLES=0 turns them off.
const storeSamples = rssSamplesEnabled();
if (!storeSamples) log('rss_samples writes disabled (RSS_SAMPLES=0)');
let titleChanges = 0, titleSyncs = 0, descChanges = 0, skippedOld = 0;
let sampled = 0, skippedSamples = 0;
const diffedChannels = new Set<string>();

for (const f of snapshotComplete ? fetched : []) {
  const observedAt = f.observedAt;
  const nowIso = observedAt.toISOString();
  // startManagedJob's run budget can abort mid-phase. A channel whose feed we fetched but did
  // NOT finish diffing must not be recorded as polled, or its changes would be dropped until
  // the next 15-minute cycle — diffedChannels is what the flush filters on.
  if (job.signal.aborted) break;
  for (const e of f.entries) {
    const cur = snap.get(e.video_id);

    // Unknown id: queue it only if it is a genuinely NEW upload. An old catalogue entry the
    // feed still lists is a backfill question, not discovery (see isNewUpload).
    if (!cur) {
      // Keep the reading either way (unknownEntryPlan): rss_samples has no FK to videos, so the
      // launch-minute view count survives the wait for the drainer to import the video. Before
      // 2026-09-04 this branch dropped it and the first stored reading came from import time.
      const plan = unknownEntryPlan(e, observedAt, lastSamples.get(e.video_id));
      if (plan.queue) buf.touchQueue.push({ ref: e.video_id, source_url: `feed:/rss/${f.channel_id}` });
      else skippedOld++;
      if (storeSamples && plan.sample && triage.sampleMayStore(e.video_id)) { buf.samples.push({ video_id: e.video_id, at: nowIso, views: e.views, likes: e.likes }); sampled++; }
      continue;
    }

    // Free stats trace for EVERY entry the feed carries, deduped on change rather than on age
    // (shouldStoreSample). The old 30-day gate threw away the back-catalogue readings the
    // long-tail fit has no data for, and still wrote a repeat row every tick for young videos.
    if (storeSamples && triage.sampleMayStore(e.video_id) && shouldStoreSample(lastSamples.get(e.video_id), e.views, observedAt)) {
      buf.samples.push({ video_id: e.video_id, at: nowIso, views: e.views, likes: e.likes });
      sampled++;
    } else {
      skippedSamples++;
    }

    const evidence = { publishedAt: cur.published_at, titleObservedAt: cur.title_observed_at };

    // --- title ---
    if (e.title && cur.title && e.title !== cur.title) {
      const kind = classifyTitleDiff(evidence, now);
      const backfill = kind === 'sync';
      const plan = titleVersionPlan(cur.titleMaxVersion ?? 0);
      if (plan.seedVersion1) {
        buf.titleVersions.push({
          video_id: e.video_id, version: 1, title: cur.title, backfill: true,
          first_seen: (cur.published_at ?? now).toISOString(),
        });
      }
      buf.titleVersions.push({ video_id: e.video_id, version: plan.newVersion, title: e.title, first_seen: nowIso, backfill });
      buf.videoTitles.push({ video_id: e.video_id, title: e.title });
      if (backfill) { titleSyncs++; buf.titleChecks.push(e.video_id); }
      else { titleChanges++; buf.reentries.push(e.video_id); log(`TITLE CHANGE ${e.video_id}: "${cur.title}" -> "${e.title}"`); }
    } else {
      buf.observed.push(e.video_id);
      buf.titleChecks.push(e.video_id);
    }

    // --- description --- (archived only; no feed event, explicitly out of scope in the plan)
    if (e.description != null && !cur.quiet) {
      const feedSha = sha(e.description);
      const isSync = classifyTitleDiff(evidence, now) === 'sync';
      if (cur.descVersion == null) {
        const base = cur.description ?? '';
        buf.descVersions.push({ video_id: e.video_id, version: 1, sha256: sha(base), description: base,
                                first_seen: (cur.published_at ?? now).toISOString(), backfill: true });
        if (sha(base) !== feedSha) {
          buf.descVersions.push({ video_id: e.video_id, version: 2, sha256: feedSha, description: e.description,
                                  first_seen: nowIso, backfill: isSync });
          if (!isSync) descChanges++;
        }
      } else if (cur.descSha !== feedSha) {
        buf.descVersions.push({ video_id: e.video_id, version: cur.descVersion + 1, sha256: feedSha,
                                description: e.description, first_seen: nowIso, backfill: isSync });
        if (!isSync) descChanges++;
      }
    }

    // --- due now for the CDN watcher ---
    // 'epoch' is older than every recheck window in every tier of both ladders.
    if (cur.thumbVersion != null && cur.thumbLastChecked && cur.thumbLastChecked > new Date(0)
        && isUpdatedSince(e.updated, cur.thumbLastChecked)) {
      buf.dueNow.push({ video_id: e.video_id, version: cur.thumbVersion });
    }
  }
  // Preserve evidence even for identical counts: these reads are the denominator and
  // can advance the response watermark without adding another rss_samples row.
  buf.responses.push({ ...f.evidence, channelId: f.channel_id,
    views: Object.fromEntries(f.entries.filter(e => e.views != null && Number.isFinite(e.views) && e.views >= 0)
      .map(e => [e.video_id, e.views!])) });
  diffedChannels.add(f.channel_id);
}

// Drop the channel-state rows for feeds we fetched but never got to diff (budget abort). They
// stay due and are re-polled next tick: one wasted fetch, never a missed change. Channels that
// 304'd or errored were never in `fetched` and are kept.
const fetchedIds = new Set(fetched.map((f) => f.channel_id));
const droppedChannels = buf.channels.filter((c) => fetchedIds.has(c.channel_id) && !diffedChannels.has(c.channel_id)).length;
if (droppedChannels) {
  buf.channels = completedChannelRows(buf.channels, fetchedIds, diffedChannels);
  log(`ABORTED mid-tick: ${droppedChannels} fetched feeds left un-diffed and still due`);
}
const diffSecs = secs(t2);

// ---------------------------------------------------------------- phase 4: flush

const t3 = Date.now();
let written: Record<string, number> = {};
// Journal BEFORE the first write: a hard process exit during flush is replayable too. The
// pending file is empty here (drainPending ran above), so this tick owns it.
fs.mkdirSync(path.dirname(PENDING), { recursive: true });
writePending([{ ...buf, journaledAt: now.toISOString() }]);
const drained = await drainPending('flush');
written = drained.written;
if (!drained.ok && !job.signal.aborted) {
  console.error(`FLUSH INCOMPLETE, remaining chunks kept in ${PENDING} for the next tick`);
  process.exitCode = 1;
} else if (!drained.ok) {
  log(`flush paused at the run budget; remaining chunks written first thing next tick`);
}
const flushSecs = secs(t3);

log(
  `done in ${secs(t0)}s (fetch ${fetchSecs}s, snapshot ${snapSecs}s, diff ${diffSecs}s, flush ${flushSecs}s): ` +
  `${ok200} x 200 (${sameBody} identical body), ${notModified} x 304, ${errors} errors; ` +
  `${written['touch_queue'] ?? 0} new videos queued of ${buf.touchQueue.length} offered ` +
  `(${skippedOld} older unknown entries skipped), ` +
  `${titleChanges} title changes (${titleSyncs} synced), ${descChanges} description changes, ` +
  `${buf.dueNow.length} marked due-now, ${written['rss_samples'] ?? 0} rss_samples (${sampled} candidates before freshness/replay filtering; ${skippedSamples} unchanged readings skipped)`
);
log(`rows written: ${JSON.stringify(written)}`);
log(`flush step ms: ${JSON.stringify(flushMs)}`);
if (SHADOW) log(`pipeline shadow: ${JSON.stringify(shadowTotals)}`);
// Silence detector: the 2026-09-11 outage wrote nothing for 11 days and nobody noticed.
// Index-only scan on idx_rss_samples_at (EXPLAIN 2026-09-22: 5 buffers, 0.05 ms).
try {
  const { rows: sil } = await pool.query(`select round(extract(epoch from now() - max(at)) / 60)::int as m from rss_samples`);
  log(`rss_silence_minutes: ${sil[0]?.m ?? 'null'}`);
} catch (e) { console.error(`rss_silence_minutes: unavailable (${(e as Error).message})`); }
await pool.end();
await closePipelinePool();
job.finish();
