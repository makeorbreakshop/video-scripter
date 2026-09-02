// Feed-event materializer. Direct Postgres only; runs every 5 minutes from launchd.
//   npx tsx scripts/feed-materialize.ts                 incremental from the stored watermarks
//   npx tsx scripts/feed-materialize.ts --since 7d      (re)seed every watermark to now() - 7d first
//   npx tsx scripts/feed-materialize.ts --catch-up      keep going until every source is caught up
//   npx tsx scripts/feed-materialize.ts --dry-run       report what it would write, write nothing
// Reads: videos, thumbnail_versions, title_versions, video_scores. Writes: feed_events, feed_watermarks.
// All the interesting mapping lives in lib/feed/materialize.ts (pure, unit-tested); this file is I/O.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import pg from 'pg';
import {
  uploadEvents, thumbnailEvents, titleEvents, outlierEvents,
  FeedEvent, OUTLIER_MIN_SCORE, OUTLIER_CONFIDENCES,
} from '../lib/feed/materialize';

const DRY = process.argv.includes('--dry-run');
const CATCH_UP = process.argv.includes('--catch-up');
const sinceArg = (() => {
  const i = process.argv.indexOf('--since');
  if (i < 0) return null;
  const m = /^(\d+)d$/.exec(process.argv[i + 1] || '');
  return m ? Number(m[1]) : null;
})();

// One batch per source per pass. At a 5-minute cadence this is far more headroom than the
// watcher produces; on a cold start --catch-up loops until the backlog is drained.
const BATCH = 2000;
// Once a source is caught up, rewind its cursor a minute: source rows are stamped by the writer,
// not by commit order, so a row can land just behind a cursor we already passed. dedupe_key makes
// the re-read free. While still catching up the cursor is exact, so progress is guaranteed.
const OVERLAP_MS = 60_000;

const SOURCES = ['videos.published_at', 'videos.import_date', 'thumbnail_versions', 'title_versions', 'video_scores'];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 120000').catch(() => {}); });
const q = async (sql: string, params?: any[]): Promise<any[]> => (await pool.query(sql, params)).rows as any[];
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

interface Cursor { at: Date; id: string }

async function cursorFor(source: string): Promise<Cursor> {
  const rows = await q(`select last_at, last_id from feed_watermarks where source = $1`, [source]);
  if (rows[0]) return { at: new Date(rows[0].last_at), id: rows[0].last_id || '' };
  // First ever run for this source: start seven days back, the window the feed shows.
  const start = new Date(Date.now() - 7 * 86_400_000);
  await q(`insert into feed_watermarks (source, last_at, last_id) values ($1, $2, '') on conflict (source) do nothing`, [source, start]);
  return { at: start, id: '' };
}

async function setCursor(source: string, c: Cursor) {
  if (DRY) return;
  await q(
    `insert into feed_watermarks (source, last_at, last_id) values ($1, $2, $3)
       on conflict (source) do update set last_at = excluded.last_at, last_id = excluded.last_id`,
    [source, c.at, c.id]
  );
}

async function insertEvents(events: FeedEvent[]): Promise<number> {
  if (!events.length || DRY) return 0;
  let written = 0;
  for (let i = 0; i < events.length; i += 500) {
    const batch = events.slice(i, i + 500);
    const rows = await q(
      `insert into feed_events (type, channel_id, video_id, at, payload, dedupe_key)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::jsonb[], $6::text[])
       on conflict (dedupe_key) do nothing
       returning 1`,
      [
        batch.map((e) => e.type),
        batch.map((e) => e.channel_id),
        batch.map((e) => e.video_id),
        batch.map((e) => e.at.toISOString()),
        batch.map((e) => JSON.stringify(e.payload)),
        batch.map((e) => e.dedupe_key),
      ]
    );
    written += rows.length;
  }
  return written;
}

interface Source {
  name: string;
  /** Rows past `cursor`, ordered by the same (timestamp, id) tuple the cursor is built from. */
  read: (cursor: Cursor) => Promise<any[]>;
  /** The cursor tuple for a source row. */
  cursorOf: (row: any) => Cursor;
  map: (rows: any[]) => Promise<FeedEvent[]>;
}

/** One pass over one source. Returns whether more rows are waiting. */
async function runOnce(s: Source): Promise<{ seen: number; written: number; more: boolean }> {
  const cursor = await cursorFor(s.name);
  const rows = await s.read(cursor);
  if (!rows.length) return { seen: 0, written: 0, more: false };
  const events = await s.map(rows);
  const written = await insertEvents(events);
  const last = s.cursorOf(rows[rows.length - 1]);
  const more = rows.length >= BATCH;
  // Exact cursor while draining a backlog (so we always step past duplicate timestamps);
  // rewound cursor once caught up (so late-stamped rows are picked up).
  await setCursor(s.name, more ? last : { at: new Date(last.at.getTime() - OVERLAP_MS), id: '' });
  if (written || more) log(`${s.name}: ${rows.length} rows -> ${events.length} events, ${written} new (cursor ${last.at.toISOString()})`);
  return { seen: rows.length, written, more };
}

// ---- uploads: two cursors, because a video enters the feed either by being published (live
// channels) or by being imported (back-catalog), and each has its own index on videos.
// A back-catalog import is only news if the video is actually new to the world: importing a
// channel's 800-video history is one tracking decision, not 800 uploads, and without this the
// corpus importer alone buries the feed under ~150K "uploads" a week.
const IMPORT_FRESH_WINDOW = "30 days";

function uploadSource(column: 'published_at' | 'import_date'): Source {
  const freshOnly = column === 'import_date' ? `and published_at > import_date - interval '${IMPORT_FRESH_WINDOW}'` : '';
  return {
    name: `videos.${column}`,
    read: (c) => q(
      `select id as video_id, channel_id, title, published_at, import_date
         from videos
        where ${column} >= $1 and (${column} > $1 or id > $2) and ${column} <= now() and published_at is not null
              and coalesce(is_short, false) = false and coalesce(duration, '') <> 'P0D'
              ${freshOnly}
        order by ${column}, id
        limit ${BATCH}`,
      [c.at, c.id]
    ),
    cursorOf: (r) => ({ at: new Date(r[column]), id: r.video_id }),
    map: async (rows) => uploadEvents(rows),
  };
}

const thumbnailSource: Source = {
  name: 'thumbnail_versions',
  read: (c) => q(
    `select tv.video_id, tv.version, tv.phash, tv.first_seen, tv.id::text as row_id, v.channel_id, v.published_at
       from thumbnail_versions tv
       join videos v on v.id = tv.video_id
      where tv.first_seen >= $1 and (tv.first_seen > $1 or tv.id::text > $2) and tv.version > 1
      order by tv.first_seen, tv.id
      limit ${BATCH}`,
    [c.at, c.id]
  ),
  cursorOf: (r) => ({ at: new Date(r.first_seen), id: r.row_id }),
  map: async (rows) => {
    // Prior phashes per video, so a version whose picture equals an earlier one reads as a
    // rotation back to a previous thumbnail rather than a fresh swap.
    const ids = [...new Set(rows.map((r) => r.video_id))];
    const history = await q(
      `select video_id, version, phash from thumbnail_versions where video_id = any($1) and phash is not null`,
      [ids]
    );
    const byVideo = new Map<string, { version: number; phash: string }[]>();
    for (const h of history) {
      if (!byVideo.has(h.video_id)) byVideo.set(h.video_id, []);
      byVideo.get(h.video_id)!.push({ version: h.version, phash: h.phash });
    }
    const out: FeedEvent[] = [];
    for (const r of rows) {
      const prior = new Set((byVideo.get(r.video_id) || []).filter((h) => h.version < r.version).map((h) => h.phash));
      out.push(...thumbnailEvents([r], new Map([[r.video_id, prior]])));
    }
    return out;
  },
};

const titleSource: Source = {
  name: 'title_versions',
  read: (c) => q(
    `select t.video_id, t.version, t.title, t.first_seen, v.channel_id, v.published_at,
            p.title as previous_title, t.video_id || ':' || t.version as row_id
       from title_versions t
       join videos v on v.id = t.video_id
       left join title_versions p on p.video_id = t.video_id and p.version = t.version - 1
      where t.first_seen >= $1 and (t.first_seen > $1 or (t.video_id || ':' || t.version) > $2) and t.version > 1
      order by t.first_seen, row_id
      limit ${BATCH}`,
    [c.at, c.id]
  ),
  cursorOf: (r) => ({ at: new Date(r.first_seen), id: r.row_id }),
  map: async (rows) => titleEvents(rows),
};

const outlierSource: Source = {
  name: 'video_scores',
  read: (c) => q(
    `select s.video_id, s.channel_id, s.score, s.est30, s.baseline, s.confidence, s.scored_at, v.published_at
       from video_scores s join videos v on v.id = s.video_id
      where scored_at >= $1 and (scored_at > $1 or video_id > $2)
        and score >= $3 and confidence = any($4)
      order by scored_at, video_id
      limit ${BATCH}`,
    [c.at, c.id, OUTLIER_MIN_SCORE, [...OUTLIER_CONFIDENCES]]
  ),
  cursorOf: (r) => ({ at: new Date(r.scored_at), id: r.video_id }),
  map: async (rows) => {
    const ids = [...new Set(rows.map((r) => r.video_id))];
    const flagged = await q(
      `select distinct video_id from feed_events where type = 'outlier' and video_id = any($1)`,
      [ids]
    );
    return outlierEvents(rows, new Set(flagged.map((r) => r.video_id)));
  },
};

// User-tracked channels get their whole upload history in the feed (reverse-chronological
// timeline), not just what arrived after tracking. Bounded per run; idempotent via dedupe_key.
async function backfillUserChannelUploads(): Promise<number> {
  const rows = await q(
    `select v.id as video_id, v.channel_id, v.title, v.published_at, v.import_date
       from videos v
       join channel_tracking ct on ct.channel_id = v.channel_id and ct.lane = 'user'
      where v.published_at is not null and coalesce(v.is_short, false) = false and coalesce(v.duration, '') <> 'P0D'
        and not exists (select 1 from feed_events f where f.type = 'upload' and f.video_id = v.id)
      order by v.published_at desc
      limit 5000`,
    []
  );
  if (!rows.length) return 0;
  return insertEvents(uploadEvents(rows));
}

async function main() {
  if (sinceArg != null) {
    const start = new Date(Date.now() - sinceArg * 86_400_000);
    log(`seeding all cursors to ${start.toISOString()}`);
    if (!DRY) {
      await q(
        `insert into feed_watermarks (source, last_at, last_id)
         select unnest($1::text[]), $2, ''
           on conflict (source) do update set last_at = excluded.last_at, last_id = ''`,
        [SOURCES, start]
      );
    }
  }

  // Sequential on purpose: one pool, one small DB, and this box shares it with the watcher.
  const sources: Source[] = [uploadSource('published_at'), uploadSource('import_date'), thumbnailSource, titleSource, outlierSource];

  const totals = new Map<string, number>();
  for (const s of sources) {
    // A single pass keeps each launchd run bounded; --catch-up drains a cold-start backlog.
    let passes = 0;
    for (;;) {
      const r = await runOnce(s);
      totals.set(s.name, (totals.get(s.name) || 0) + r.written);
      if (!r.more || !CATCH_UP || ++passes > 500) break;
    }
  }

  const counts = await q(
    `select type, count(*)::int as n from feed_events where at > now() - interval '7 days' group by type order by n desc`
  );
  log(`wrote: ${[...totals].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  log(`feed_events in the last 7 days: ${counts.map((c) => `${c.type}=${c.n}`).join(' ') || 'none'}`);
  const backfilled = DRY ? 0 : await backfillUserChannelUploads();
  if (backfilled) log(`user-channel upload history: +${backfilled}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => pool.end());
