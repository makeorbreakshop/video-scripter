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
// and the NEXT tick replays it before fetching anything. A tick therefore never silently loses
// a change it detected.
//
// MEASURED 2026-09-03: this feed sends no ETag and no Last-Modified, so the conditional-request
// path never fires. "Unchanged" is decided by hashing the body (rss_body_sha), which skips the
// whole diff for that channel.
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
import { withDeadlockRetry } from '../lib/nightly/pg-retry';
import { reenter } from '../lib/nightly/launch-core';
import { startManagedJob } from '../lib/nightly/job-lifecycle';
import { classifyTitleDiff, titleVersionPlan, TITLE_WATCH_UPSERT_SQL } from '../lib/rss/title-change';
import {
  RSS_POLICY,
  parseRssEntries,
  backoffAfter,
  perRunCap,
  isUpdatedSince,
  shouldProcessEntries,
  isNewUpload,
  shouldStoreSample,
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
const job = startManagedJob({ name: 'rss-poll', args });
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
/**
 * How stale an observation stamp may get before we rewrite it. The CHANGE/SYNC rule only needs
 * evidence inside a 7-day window, so re-stamping the same ~50K videos every 5 minutes is pure
 * write amplification — it was the bulk of a 178.9 s flush. An hour keeps the evidence
 * effectively fresh and makes the steady-state stamp update touch almost nothing.
 */
const STAMP_MAX_AGE = "interval '1 hour'";

// ---------------------------------------------------------------- buffers

interface Buffers {
  samples: { video_id: string; at: string; views: number | null; likes: number | null }[];
  /** Videos whose title we looked at, changed or not. This is the evidence the 7-day rule reads. */
  observed: string[];
  titleVersions: { video_id: string; version: number; title: string; first_seen: string; backfill: boolean }[];
  videoTitles: { video_id: string; title: string }[];
  /** Real changes only: re-open the stats lane's 5-minute ladder. */
  reentries: string[];
  /** Syncs and unchanged: just stamp that we looked. */
  titleChecks: string[];
  descVersions: { video_id: string; version: number; sha256: string; description: string; first_seen: string; backfill: boolean }[];
  dueNow: { video_id: string; version: number }[];
  touchQueue: { ref: string; source_url: string }[];
  channels: { channel_id: string; status: number | null; body_sha: string | null; etag: string | null;
              interval_sec: number | null; backoff_until: string | null; clear_woken: boolean }[];
}

const empty = (): Buffers => ({
  samples: [], observed: [], titleVersions: [], videoTitles: [], reentries: [],
  titleChecks: [], descVersions: [], dueNow: [], touchQueue: [], channels: [],
});

// ---------------------------------------------------------------- flush

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
    for (const part of chunk(rows, CHUNK)) {
      // Deterministic lock order + retry: launch-track, the drainer and this poller all write
      // videos/track_schedule, and two statements taking overlapping ids in different orders
      // deadlock (observed 40P01 on the first full-corpus flush).
      const res = await withDeadlockRetry(() => pool.query(sql, cols(part)));
      n += actual ? (res.rowCount ?? 0) : part.length;
    }
    written[name] = (written[name] ?? 0) + n;
  };

  await insert('rss_samples',
    `insert into rss_samples (video_id, at, views, likes)
     select * from unnest($1::text[], $2::timestamptz[], $3::bigint[], $4::bigint[])
     on conflict do nothing`,
    b.samples, (p) => [p.map((r: any) => r.video_id), p.map((r: any) => r.at), p.map((r: any) => r.views), p.map((r: any) => r.likes)]);

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

  await insert('track_schedule.checked',
    `update track_schedule set last_title_check = $2
      where video_id = any($1) and (last_title_check is null or last_title_check < now() - ${STAMP_MAX_AGE})
      returning 1`,
    b.titleChecks, (p) => [p, now], true);

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

/** Replay a buffer a previous tick could not write, before this tick fetches anything. */
async function replayPending(): Promise<void> {
  if (!fs.existsSync(PENDING)) return;
  const text = fs.readFileSync(PENDING, 'utf8').trim();
  if (!text) { fs.unlinkSync(PENDING); return; }
  try {
    const merged = empty();
    for (const line of text.split('\n')) {
      const b = JSON.parse(line) as Buffers;
      for (const k of Object.keys(merged) as (keyof Buffers)[]) {
        (merged[k] as any[]).push(...((b[k] as any[]) ?? []));
      }
    }
    const w = await flush(merged);
    fs.unlinkSync(PENDING);
    log(`replayed pending buffer: ${JSON.stringify(w)}`);
  } catch (e) {
    // Leave the file in place; the next tick tries again rather than dropping detected changes.
    console.error(`pending replay failed, keeping ${PENDING}: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------- phase 0

if (subset || forceSeed || now.getMinutes() < 5) {
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
  job.finish();
  process.exit(0);
}

await replayPending();

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
interface Fetched { channel_id: string; entries: RssEntry[] }
const fetched: Fetched[] = [];

for (const group of chunk(due as DueChannel[], RSS_POLICY.concurrency)) {
  if (job.signal.aborted) break;
  await Promise.all(group.map(async (c) => {
    let status = 0;
    try {
      const headers: Record<string, string> = {};
      if (c.rss_etag) headers['If-None-Match'] = c.rss_etag;
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channel_id}`, {
        headers, signal: AbortSignal.timeout(RSS_POLICY.timeoutMs),
      });
      status = res.status;
      if (status === 304) {
        notModified++;
        buf.channels.push({ channel_id: c.channel_id, status: 304, body_sha: null, etag: c.rss_etag,
                            interval_sec: null, backoff_until: null, clear_woken: true });
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${status}`);
      ok200++;
      const body = await res.text();
      const bodySha = sha(body);
      buf.channels.push({ channel_id: c.channel_id, status: 200, body_sha: bodySha,
                          etag: res.headers.get('etag'), interval_sec: null, backoff_until: null, clear_woken: true });
      if (!shouldProcessEntries(c.rss_body_sha, bodySha)) { sameBody++; return; }
      fetched.push({ channel_id: c.channel_id, entries: parseRssEntries(body) });
    } catch (err) {
      errors++;
      const b = backoffAfter(status || 599, c.rss_state, c.rss_interval_sec, now);
      buf.channels.push({ channel_id: c.channel_id, status: status || null, body_sha: null, etag: c.rss_etag,
                          interval_sec: b.intervalSec, backoff_until: b.backoffUntil ? b.backoffUntil.toISOString() : null,
                          clear_woken: false });
      console.error(`${c.channel_id}: ${err instanceof Error ? err.message : 'fetch error'}`);
    }
  }));
}
const fetchSecs = secs(t0);
log(`fetch: ${fetchSecs}s — ${ok200} x 200 (${sameBody} identical body), ${notModified} x 304, ${errors} errors; ${fetched.length} feeds to diff`);

// ---------------------------------------------------------------- phase 2: one snapshot read

const t1 = Date.now();
const allIds = [...new Set(fetched.flatMap((f) => f.entries.map((e) => e.video_id)))];

interface Snap {
  title: string | null; description: string | null; published_at: Date | null;
  title_observed_at: Date | null;
  /** Last stored rss_samples reading, for the change-based dedupe. */
  lastSample?: { views: number | null; at: Date };
  descVersion?: number; descSha?: string;
  titleMaxVersion?: number;
  thumbVersion?: number; thumbLastChecked?: Date;
}
const snap = new Map<string, Snap>();
// Chunked so no single statement carries a 60K-element array.
let snapshotComplete = true;
for (const part of chunk(allIds, CHUNK)) {
  // A partial snapshot is worse than none: a video missing from `snap` looks like an unknown id
  // and would be queued as a new upload, and its real title/description diff would be missed.
  if (job.signal.aborted) { snapshotComplete = false; break; }
  const [v, d, t, th, ls] = await Promise.all([
    pool.query(`select v.id, v.title, v.description, v.published_at, w.title_observed_at
                  from videos v left join video_title_watch w on w.video_id = v.id
                 where v.id = any($1)`, [part]),
    pool.query(`select distinct on (video_id) video_id, version, sha256 from description_versions
                 where video_id = any($1) order by video_id, version desc`, [part]),
    pool.query(`select video_id, max(version)::int as v from title_versions where video_id = any($1) group by video_id`, [part]),
    pool.query(`select distinct on (video_id) video_id, version, last_checked from thumbnail_versions
                 where video_id = any($1) order by video_id, version desc`, [part]),
    // The change-based rss_samples dedupe (shouldStoreSample). ONE set-based read per chunk,
    // in the snapshot phase — never a per-channel query inside the fetch loop.
    pool.query(LAST_SAMPLES_SQL, [part]),
  ]);
  for (const r of v.rows) snap.set(r.id, { title: r.title, description: r.description, published_at: r.published_at, title_observed_at: r.title_observed_at });
  for (const r of d.rows) { const s = snap.get(r.video_id); if (s) { s.descVersion = r.version; s.descSha = r.sha256; } }
  for (const r of t.rows) { const s = snap.get(r.video_id); if (s) s.titleMaxVersion = r.v; }
  for (const r of th.rows) { const s = snap.get(r.video_id); if (s) { s.thumbVersion = r.version; s.thumbLastChecked = r.last_checked; } }
  for (const r of ls.rows) { const s = snap.get(r.video_id); if (s) s.lastSample = { views: r.views == null ? null : Number(r.views), at: r.at }; }
}
const snapSecs = secs(t1);
if (!snapshotComplete) { fetched.length = 0; log('snapshot aborted mid-way; skipping the diff so no feed is half-read'); }
log(`snapshot: ${snapSecs}s — ${allIds.length} feed video ids, ${snap.size} already in the corpus`);

// ---------------------------------------------------------------- phase 3: diff, in memory

const t2 = Date.now();
const nowIso = now.toISOString();
let titleChanges = 0, titleSyncs = 0, descChanges = 0, skippedOld = 0;
let sampled = 0, skippedSamples = 0;
const diffedChannels = new Set<string>();

for (const f of fetched) {
  // startManagedJob's run budget can abort mid-phase. A channel whose feed we fetched but did
  // NOT finish diffing must not be recorded as polled, or its changes would be dropped until
  // the next 15-minute cycle — diffedChannels is what the flush filters on.
  if (job.signal.aborted) break;
  for (const e of f.entries) {
    const cur = snap.get(e.video_id);

    // Unknown id: queue it only if it is a genuinely NEW upload. An old catalogue entry the
    // feed still lists is a backfill question, not discovery (see isNewUpload).
    if (!cur) {
      if (isNewUpload(e.published, now)) buf.touchQueue.push({ ref: e.video_id, source_url: `feed:/rss/${f.channel_id}` });
      else skippedOld++;
      continue;
    }

    // Free stats trace for EVERY entry the feed carries, deduped on change rather than on age
    // (shouldStoreSample). The old 30-day gate threw away the back-catalogue readings the
    // long-tail fit has no data for, and still wrote a repeat row every tick for young videos.
    if (shouldStoreSample(cur.lastSample ?? null, e.views, now)) {
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
    if (e.description != null) {
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
  diffedChannels.add(f.channel_id);
}

// Drop the channel-state rows for feeds we fetched but never got to diff (budget abort). They
// stay due and are re-polled next tick: one wasted fetch, never a missed change. Channels that
// 304'd, matched on body hash, or errored were never in `fetched` and are kept.
const fetchedIds = new Set(fetched.map((f) => f.channel_id));
const droppedChannels = buf.channels.filter((c) => fetchedIds.has(c.channel_id) && !diffedChannels.has(c.channel_id)).length;
if (droppedChannels) {
  buf.channels = buf.channels.filter((c) => !fetchedIds.has(c.channel_id) || diffedChannels.has(c.channel_id));
  log(`ABORTED mid-tick: ${droppedChannels} fetched feeds left un-diffed and still due`);
}
const diffSecs = secs(t2);

// ---------------------------------------------------------------- phase 4: flush

const t3 = Date.now();
let written: Record<string, number> = {};
try {
  written = await flush(buf);
} catch (e) {
  fs.mkdirSync(path.dirname(PENDING), { recursive: true });
  fs.appendFileSync(PENDING, JSON.stringify(buf) + '\n');
  console.error(`FLUSH FAILED, buffered to ${PENDING} for the next tick: ${(e as Error).message}`);
  process.exitCode = 1;
}
const flushSecs = secs(t3);

log(
  `done in ${secs(t0)}s (fetch ${fetchSecs}s, snapshot ${snapSecs}s, diff ${diffSecs}s, flush ${flushSecs}s): ` +
  `${ok200} x 200 (${sameBody} identical body), ${notModified} x 304, ${errors} errors; ` +
  `${written['touch_queue'] ?? 0} new videos queued of ${buf.touchQueue.length} offered ` +
  `(${skippedOld} older unknown entries skipped), ` +
  `${titleChanges} title changes (${titleSyncs} synced), ${descChanges} description changes, ` +
  `${buf.dueNow.length} marked due-now, ${sampled} rss_samples (${skippedSamples} unchanged readings skipped)`
);
log(`rows written: ${JSON.stringify(written)}`);
await pool.end();
job.finish();
