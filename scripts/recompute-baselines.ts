// Full-corpus baseline/score recompute under the UNIFIED ratio convention
// (lib/baselines/core.ts). Fixes the historical unit schizophrenia by
// rewriting every non-short video's channel_baseline_at_publish (ratio) and
// temporal_performance_score through one code path.
// Idempotent and resumable: processes channels alphabetically, tracks progress
// in baseline_recompute_progress. Usage: npx tsx scripts/recompute-baselines.ts
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import {
  day30Estimate,
  rawBaselineAt,
  baselineRatio,
  temporalScore,
} from '../lib/baselines/core';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
});
// pgbouncer strips startup options; SET per connection instead (session pooler)
pool.on('connect', (c) => { c.query('set statement_timeout = 0').catch(() => {}); });

await pool.query(`create table if not exists baseline_recompute_progress (
  channel_id text primary key, videos int, done_at timestamptz default now())`);

const envelope = new Map<number, number>();
for (const r of (await pool.query(
  `select day_since_published, p50_views from performance_envelopes where day_since_published <= 365`
)).rows) {
  envelope.set(r.day_since_published, parseFloat(r.p50_views));
}
console.log(`Envelope points: ${envelope.size}`);

const { rows: channels } = await pool.query(`
  select distinct v.channel_id from videos v
  left join baseline_recompute_progress p on p.channel_id = v.channel_id
  where v.channel_id is not null and p.channel_id is null
  order by v.channel_id`);
console.log(`Channels to recompute: ${channels.length}`);

let done = 0;
let videosDone = 0;
for (const { channel_id } of channels) {
  const { rows: vids } = await pool.query(
    `select id, published_at, view_count::float8 as view_count,
            date_part('day', now() - published_at) as age_days
     from videos where channel_id = $1 and (is_short = false or is_short is null)
     order by published_at`,
    [channel_id]
  );
  if (!vids.length) {
    await pool.query(
      `insert into baseline_recompute_progress (channel_id, videos) values ($1, 0)
       on conflict do nothing`, [channel_id]);
    done++;
    continue;
  }

  const { rows: snaps } = await pool.query(
    `select video_id, view_count::float8 as view_count, days_since_published
     from view_snapshots where video_id = any($1)`,
    [vids.map((v) => v.id)]
  );
  const byVideo = new Map<string, { view_count: number; days_since_published: number }[]>();
  for (const s of snaps) {
    if (!byVideo.has(s.video_id)) byVideo.set(s.video_id, []);
    byVideo.get(s.video_id)!.push(s);
  }

  for (const v of vids) {
    (v as any).day30_estimate = day30Estimate(v.view_count, v.age_days, byVideo.get(v.id) || [], envelope);
  }

  const updates: { id: string; ratio: number; score: number }[] = [];
  for (let i = 0; i < vids.length; i++) {
    const raw = rawBaselineAt(vids as any, i);
    const ratio = baselineRatio(raw, envelope);
    const score = temporalScore((vids[i] as any).day30_estimate, ratio, envelope);
    updates.push({ id: vids[i].id, ratio, score });
  }

  const CHUNK = 500;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const values = chunk
      .map((_, idx) => `($${idx * 3 + 1}, $${idx * 3 + 2}::numeric, $${idx * 3 + 3}::numeric)`)
      .join(',');
    await pool.query(
      `update videos v set channel_baseline_at_publish = u.ratio, temporal_performance_score = u.score
       from (values ${values}) as u(id, ratio, score) where v.id = u.id`,
      chunk.flatMap((u) => [u.id, u.ratio, u.score])
    );
  }

  await pool.query(
    `insert into baseline_recompute_progress (channel_id, videos) values ($1, $2)
     on conflict do nothing`, [channel_id, vids.length]);
  done++;
  videosDone += vids.length;
  if (done % 200 === 0) console.log(`[${done}/${channels.length}] channels, ${videosDone} videos rewritten`);
}
console.log(`RECOMPUTE COMPLETE: ${done} channels, ${videosDone} videos on the unified ratio convention.`);
await pool.end();
