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
import { recordTitleChange } from '../lib/rss/title-change';
import {
  RSS_POLICY,
  parseRssEntries,
  backoffAfter,
  perRunCap,
  isUpdatedSince,
  SEED_SUBSET_SQL,
  SEED_ALL_SQL,
  DUE_CHANNELS_SQL,
  STATE_COUNTS_SQL,
  type RssState,
} from '../lib/rss/poll-policy';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const subset = args.includes('--subset') || process.env.WATCH_SUBSET === '1';
const forceSeed = args.includes('--seed');
const maxChannels = parseInt(args.find((a) => /^\d+$/.test(a)) || '0', 10) || null;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
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
let newVideos = 0, titleChanges = 0, descChanges = 0, dueNow = 0, samples = 0;

async function handleEntry(channelId: string, e: ReturnType<typeof parseRssEntries>[number]) {
  const { rows: v } = await pool.query(
    `select id, title, description, published_at from videos where id = $1`, [e.video_id]
  );

  // 1. Unknown video: hand it to the touch queue. Never insert straight into videos.
  if (!v.length) {
    const ins = await pool.query(
      `insert into touch_queue (kind, ref, source_url, mode)
       values ('video', $1, $2, 'websub') on conflict (kind, ref) do nothing`,
      [e.video_id, `websub:${channelId}`]
    ).catch(() => ({ rowCount: 0 }));
    if (ins.rowCount) { newVideos++; log(`NEW VIDEO queued ${e.video_id} (${channelId})`); }
    return;
  }
  const cur = v[0];

  // 2. Free stats trace. Not scoring input; view_samples stays the source of truth.
  if (e.views != null || e.likes != null) {
    await pool.query(
      `insert into rss_samples (video_id, at, views, likes) values ($1,$2,$3,$4) on conflict do nothing`,
      [e.video_id, now, e.views, e.likes]
    );
    samples++;
  }

  // 3. Title change: shared write path (lib/rss/title-change.ts), including the stats-lane
  // re-entry. feed-materialize.ts turns the title_versions row into the title_change event.
  if (e.title && cur.title && e.title !== cur.title) {
    await recordTitleChange(pool, e.video_id, cur.title, e.title, cur.published_at, now);
    titleChanges++;
    log(`TITLE CHANGE ${e.video_id}: "${cur.title}" -> "${e.title}"`);
  } else {
    await pool.query(
      `update track_schedule set last_title_check = now() where video_id = $1`, [e.video_id]
    ).catch(() => {});
  }

  // 4. Description change: archived only, no feed event (explicitly out of scope).
  if (e.description != null) {
    const descSha = sha(e.description);
    const { rows: dv } = await pool.query(
      `select version, sha256 from description_versions where video_id = $1 order by version desc limit 1`,
      [e.video_id]
    );
    if (!dv.length) {
      // Baseline what we already had, then the feed's version if it differs.
      const base = cur.description ?? '';
      await pool.query(
        `insert into description_versions (video_id, version, sha256, description, first_seen)
         values ($1, 1, $2, $3, $4) on conflict do nothing`,
        [e.video_id, sha(base), base, cur.published_at ?? now]
      );
      if (sha(base) !== descSha) {
        await pool.query(
          `insert into description_versions (video_id, version, sha256, description)
           values ($1, 2, $2, $3) on conflict do nothing`,
          [e.video_id, descSha, e.description]
        );
        descChanges++;
      }
    } else if (dv[0].sha256 !== descSha) {
      await pool.query(
        `insert into description_versions (video_id, version, sha256, description)
         values ($1, $2, $3, $4) on conflict do nothing`,
        [e.video_id, dv[0].version + 1, descSha, e.description]
      );
      descChanges++;
      log(`DESCRIPTION CHANGE ${e.video_id} -> v${dv[0].version + 1}`);
    }
  }

  // 5. The feed says this video was touched more recently than our last CDN look: make the
  // thumbnail watcher pick it up on its very next tick. last_checked is NOT NULL, so the
  // sentinel is 'epoch' — older than every tier's recheck window, in every tier.
  const { rows: t } = await pool.query(
    `select version, last_checked from thumbnail_versions where video_id = $1 order by version desc limit 1`,
    [e.video_id]
  );
  if (t.length && t[0].last_checked > new Date(0) && isUpdatedSince(e.updated, t[0].last_checked)) {
    await pool.query(
      `update thumbnail_versions set last_checked = 'epoch' where video_id = $1 and version = $2`,
      [e.video_id, t[0].version]
    );
    dueNow++;
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
      const unchanged = c.rss_body_sha === bodySha;
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
      for (const e of parseRssEntries(body)) await handleEntry(c.channel_id, e);
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
  `${newVideos} new videos queued, ${titleChanges} title changes, ${descChanges} description changes, ` +
  `${dueNow} marked due-now for the CDN watcher, ${samples} rss_samples`
);
await pool.end();
