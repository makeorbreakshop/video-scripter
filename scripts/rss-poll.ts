// Channel RSS poller — the free lane's "when did it change?" detector. ZERO Data API quota.
// Plan: docs/plans/2026-09-03-two-lane-watcher.md section 1. Policy (pure, tested) lives in
// lib/rss/poll-policy.ts; this file is I/O only.
//
// Per due channel, one GET of youtube.com/feeds/videos.xml?channel_id=... (last 15 uploads):
//   * new video id  -> touch_queue in 'websub' mode; the drainer imports it (never insert here)
//   * title diff    -> title_versions + videos.title + track_schedule re-entry (feed-materialize
//                      turns the title_versions row into the title_change feed event)
//   * desc diff     -> description_versions (no feed event; out of scope in the plan)
//   * <updated> newer than our last thumbnail look -> mark the video due NOW for the CDN watcher
//   * views/likes   -> rss_samples (free dense trace; view_samples stays the source of truth)
//
// MEASURED 2026-09-03: this feed sends no ETag and no Last-Modified, so the conditional-request
// path below effectively never fires. "Unchanged" is therefore decided by hashing the body
// (rss_body_sha), which still skips all the per-entry work. See the run counters.
//
// Direct Postgres only (2026-08-31 egress rule).
// Usage: npx tsx scripts/rss-poll.ts [maxChannels] [--subset] [--dry] [--seed]
//        WATCH_SUBSET=1 npx tsx scripts/rss-poll.ts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import crypto from 'crypto';
import { chunk } from '../lib/nightly/tracking-core';
import { recordTitleChange, recordTitleObservations, classifyTitleDiff } from '../lib/rss/title-change';
import {
  RSS_POLICY,
  parseRssEntries,
  backoffAfter,
  perRunCap,
  isUpdatedSince,
  shouldProcessEntries,
  isNewUpload,
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
const maxChannels = parseInt(args.find((a) => /^\d+$/.test(a)) || '0', 10) || null;

// max 8: the poller runs `concurrency` channels at once and each does a short burst of
// set-based statements; 4 connections serialised those bursts into a queue at full corpus.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
// pgbouncer strips startup options, so SET per connection like the other batch scripts.
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 120000').catch(() => {}); });
const now = new Date();
const log = (m: string) => console.log(`${now.toISOString()} ${m}`);
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

// --- Seed / refresh channel state from the videos table ---
// Cheap under --subset (52 channels). In full mode the group-by covers the whole corpus, so it
// only runs on the first LaunchAgent slot of the hour unless --seed forces it.
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
  process.exit(0);
}

// --- Select due channels, oldest poll first, capped so the run is a stagger and not a burst ---
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

let ok200 = 0, notModified = 0, sameBody = 0, errors = 0;
let newVideos = 0, titleChanges = 0, titleSyncs = 0, descChanges = 0, dueNow = 0, samples = 0, skippedOld = 0;

/**
 * Everything one channel's feed implies, written in a handful of set-based statements.
 *
 * The first cut of this did ~6 sequential round-trips PER ENTRY (15 entries per feed, ~90 per
 * channel). Against the pooler that was fine for the 52-channel subset and fell over completely
 * at full corpus: a 600-channel tick had not finished after 10 minutes. Everything below is
 * batched per channel, so a feed costs ~7 statements whatever its contents, and only the rare
 * real title/description change adds writes.
 */
async function handleEntries(channelId: string, entries: RssEntry[]) {
  if (!entries.length) return;
  const ids = entries.map((e) => e.video_id);
  const { rows: known } = await pool.query(
    `select id, title, description, published_at, title_observed_at from videos where id = any($1)`, [ids]
  );
  type Known = { id: string; title: string | null; description: string | null; published_at: Date | null; title_observed_at: Date | null };
  const byId = new Map<string, Known>(known.map((r: any) => [r.id, r]));

  // 1. Unknown video ids: hand them to the touch queue. Never insert straight into videos.
  // mode 'websub' is what makes the drainer import them as real uploads (tier 0); the source_url
  // is deliberately NOT the `websub:UC...` marker, which is the drainer's wake-up signal —
  // re-waking a channel we polled a second ago would poll it every tick until its backlog cleared.
  // Only genuinely new uploads. An old catalogue entry we never ingested is a backfill
  // question, not discovery — see isNewUpload for the numbers that forced this.
  const unknown = entries.filter((e) => !byId.has(e.video_id) && isNewUpload(e.published, now))
    .map((e) => e.video_id);
  skippedOld += ids.filter((id) => !byId.has(id)).length - unknown.length;
  if (unknown.length) {
    const ins = await pool.query(
      `insert into touch_queue (kind, ref, source_url, mode)
       select 'video', u, $2, 'websub' from unnest($1::text[]) u
       on conflict (kind, ref) do nothing`,
      [unknown, `feed:/rss/${channelId}`]
    ).catch(() => ({ rowCount: 0 }));
    newVideos += ins.rowCount ?? 0;
  }

  const present = entries.filter((e) => byId.has(e.video_id));
  if (!present.length) return;

  // 2. Free stats trace. Not scoring input; view_samples stays the source of truth.
  const withStats = present.filter((e) => e.views != null || e.likes != null);
  if (withStats.length) {
    await pool.query(
      `insert into rss_samples (video_id, at, views, likes)
       select * from unnest($1::text[], $2::timestamptz[], $3::bigint[], $4::bigint[])
       on conflict do nothing`,
      [withStats.map((e) => e.video_id), withStats.map(() => now),
       withStats.map((e) => e.views), withStats.map((e) => e.likes)]
    );
    samples += withStats.length;
  }

  // 3. Title changes go one at a time through the shared write path (they are rare, and each one
  // needs its own version lookup + re-entry). Everything else just gets its check stamped.
  const changed = present.filter((e) => {
    const cur = byId.get(e.video_id)!;
    return e.title && cur.title && e.title !== cur.title;
  });
  for (const e of changed) {
    const cur = byId.get(e.video_id)!;
    const r = await recordTitleChange(
      pool, e.video_id, cur.title!, e.title, cur.published_at, now, cur.title_observed_at
    );
    if (r.kind === 'change') {
      titleChanges++;
      log(`TITLE CHANGE ${e.video_id}: "${cur.title}" -> "${e.title}"`);
    } else {
      titleSyncs++;   // no feed event, no re-entry: we had no recent evidence of the old title
    }
  }
  const changedSet = new Set(changed.map((e) => e.video_id));
  const unchangedIds = present.map((e) => e.video_id).filter((id) => !changedSet.has(id));
  if (unchangedIds.length) {
    // Every observation counts, changed or not: this is the evidence the CHANGE/SYNC rule reads.
    await recordTitleObservations(pool, unchangedIds, now);
    await pool.query(
      `update track_schedule set last_title_check = now() where video_id = any($1)`, [unchangedIds]
    ).catch(() => {});
  }

  // 4. Description history. Archived only, no feed event (explicitly out of scope in the plan).
  const withDesc = present.filter((e) => e.description != null);
  if (withDesc.length) {
    const { rows: dv } = await pool.query(
      `select distinct on (video_id) video_id, version, sha256 from description_versions
        where video_id = any($1) order by video_id, version desc`,
      [withDesc.map((e) => e.video_id)]
    );
    const latest = new Map<string, { version: number; sha256: string }>(
      dv.map((r: any) => [r.video_id, { version: r.version, sha256: r.sha256 }])
    );
    const rows: { id: string; version: number; sha: string; text: string; seen: Date; isChange: boolean; backfill: boolean }[] = [];
    for (const e of withDesc) {
      const cur = byId.get(e.video_id)!;
      const feedSha = sha(e.description!);
      const prev = latest.get(e.video_id);
      // Same CHANGE/SYNC rule as titles: without recent evidence of the old description, a
      // difference is a first observation, not news. Descriptions emit no feed events yet, but
      // the backfill flag keeps the archive honest for when they do.
      const kind = classifyTitleDiff(
        { publishedAt: cur.published_at, titleObservedAt: cur.title_observed_at }, now
      );
      const isSync = kind === 'sync';
      if (!prev) {
        // The v1 row is always a baseline of what we already held, never a change.
        const base = cur.description ?? '';
        rows.push({ id: e.video_id, version: 1, sha: sha(base), text: base, seen: cur.published_at ?? now, isChange: false, backfill: true });
        if (sha(base) !== feedSha) {
          rows.push({ id: e.video_id, version: 2, sha: feedSha, text: e.description!, seen: now, isChange: !isSync, backfill: isSync });
        }
      } else if (prev.sha256 !== feedSha) {
        rows.push({ id: e.video_id, version: prev.version + 1, sha: feedSha, text: e.description!, seen: now, isChange: !isSync, backfill: isSync });
        if (!isSync) log(`DESCRIPTION CHANGE ${e.video_id} -> v${prev.version + 1}`);
      }
    }
    if (rows.length) {
      await pool.query(
        `insert into description_versions (video_id, version, sha256, description, first_seen, backfill)
         select * from unnest($1::text[], $2::int[], $3::text[], $4::text[], $5::timestamptz[], $6::boolean[])
         on conflict do nothing`,
        [rows.map((r) => r.id), rows.map((r) => r.version), rows.map((r) => r.sha),
         rows.map((r) => r.text), rows.map((r) => r.seen), rows.map((r) => r.backfill)]
      );
      descChanges += rows.filter((r) => r.isChange).length;
    }
  }

  // 5. The feed says these videos were touched more recently than our last CDN look, so make the
  // thumbnail watcher pick them up on its very next tick. last_checked is NOT NULL, so the
  // sentinel is 'epoch' — older than every recheck window, in every tier of both ladders.
  const { rows: tv } = await pool.query(
    `select distinct on (video_id) video_id, version, last_checked from thumbnail_versions
      where video_id = any($1) order by video_id, version desc`,
    [present.map((e) => e.video_id)]
  );
  const mark = tv.filter((r: any) => {
    const e = present.find((x) => x.video_id === r.video_id);
    return e && r.last_checked > new Date(0) && isUpdatedSince(e.updated, r.last_checked);
  });
  if (mark.length) {
    await pool.query(
      `update thumbnail_versions t set last_checked = 'epoch'
        from unnest($1::text[], $2::int[]) as m(video_id, version)
       where t.video_id = m.video_id and t.version = m.version`,
      [mark.map((r: any) => r.video_id), mark.map((r: any) => r.version)]
    );
    dueNow += mark.length;
  }
}

for (const group of chunk(due as DueChannel[], RSS_POLICY.concurrency)) {
  await Promise.all(group.map(async (c) => {
    let status = 0;
    try {
      const headers: Record<string, string> = {};
      if (c.rss_etag) headers['If-None-Match'] = c.rss_etag;
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.channel_id}`, {
        headers,
        signal: AbortSignal.timeout(RSS_POLICY.timeoutMs),
      });
      status = res.status;
      if (status === 304) {
        notModified++;
        await pool.query(
          `update channel_rss_state set rss_last_polled = $2, rss_last_status = 304,
                  rss_interval_sec = null, rss_backoff_until = null, updated_at = now()
            where channel_id = $1`, [c.channel_id, now]
        );
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${status}`);
      ok200++;
      const body = await res.text();
      const bodySha = sha(body);
      const etag = res.headers.get('etag');
      // Byte-identical feed: bump last_polled and stop. No rss_samples, no per-entry work.
      const unchanged = !shouldProcessEntries(c.rss_body_sha, bodySha);
      if (unchanged) sameBody++;
      // A poll clears 'woken': the push has now been confirmed by a real read.
      await pool.query(
        `update channel_rss_state set rss_last_polled = $2, rss_last_status = 200, rss_body_sha = $3,
                rss_etag = $4, rss_interval_sec = null, rss_backoff_until = null,
                rss_state = case when rss_state = 'woken' then 'active' else rss_state end,
                updated_at = now()
          where channel_id = $1`, [c.channel_id, now, bodySha, etag]
      );
      if (unchanged) return;
      await handleEntries(c.channel_id, parseRssEntries(body));
    } catch (err) {
      errors++;
      const b = backoffAfter(status || 599, c.rss_state, c.rss_interval_sec, now);
      await pool.query(
        `update channel_rss_state set rss_last_polled = $2, rss_last_status = $3,
                rss_interval_sec = $4, rss_backoff_until = $5, updated_at = now()
          where channel_id = $1`,
        [c.channel_id, now, status || null, b.intervalSec, b.backoffUntil]
      ).catch(() => {});
      console.error(`${c.channel_id}: ${err instanceof Error ? err.message : 'fetch error'}`);
    }
  }));
}

log(
  `done: ${ok200} x 200 (${sameBody} identical body), ${notModified} x 304, ${errors} errors; ` +
  `${newVideos} new videos queued (${skippedOld} older unknown entries skipped), ${titleChanges} title changes (${titleSyncs} synced, no evidence of the old title), ` +
  `${descChanges} description changes, ` +
  `${dueNow} marked due-now for the CDN watcher, ${samples} rss_samples`
);
await pool.end();
