// Detection-latency analysis on the 2025 dense-snapshot cohort.
// Question: for videos that ENDED as outliers (>=3x channel median day-30),
// at what age were they first detectable, and what would the proposed
// {1,2,3,5,7,14,30} sampling schedule have caught vs daily sampling?
// Read-only; results printed as a summary table.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { day30Estimate, median, Snapshot } from '../../lib/baselines/core';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('connect', (c) => { c.query('set statement_timeout = 0').catch(() => {}); });

// Envelope
const envelope = new Map<number, number>();
for (const r of (await pool.query(
  `select day_since_published, p50_views from performance_envelopes where day_since_published <= 365`
)).rows) envelope.set(r.day_since_published, parseFloat(r.p50_views));

// Cohort: densely-tracked videos from the 2025 tracking era
const { rows: cohort } = await pool.query(`
  select v.id, v.channel_id, v.published_at
  from videos v
  where v.published_at >= '2025-05-01' and v.published_at < '2025-08-15'
    and (v.is_short = false or v.is_short is null)
    and exists (
      select 1 from view_snapshots s
      where s.video_id = v.id and s.days_since_published between 0 and 45
      group by s.video_id having count(*) >= 8
    )
  limit 30000`);
console.log(`Dense cohort: ${cohort.length} videos`);

// Load their early snapshots
const snapsByVideo = new Map<string, Snapshot[]>();
const ids = cohort.map((c) => c.id);
for (let i = 0; i < ids.length; i += 2000) {
  const { rows } = await pool.query(
    `select video_id, view_count::float8 as view_count, days_since_published
     from view_snapshots where video_id = any($1) and days_since_published between 0 and 60
     order by video_id, days_since_published`,
    [ids.slice(i, i + 2000)]
  );
  for (const s of rows) {
    if (!snapsByVideo.has(s.video_id)) snapsByVideo.set(s.video_id, []);
    snapsByVideo.get(s.video_id)!.push({ view_count: s.view_count, days_since_published: s.days_since_published });
  }
}
console.log(`Snapshots loaded for ${snapsByVideo.size} videos`);

// Final day-30 estimate per video; channel medians (channels with >=5 cohort videos)
interface V { id: string; channel_id: string; day30: number }
const vids: V[] = [];
for (const c of cohort) {
  const snaps = snapsByVideo.get(c.id) || [];
  if (!snaps.length) continue;
  vids.push({ id: c.id, channel_id: c.channel_id, day30: day30Estimate(0, 30, snaps, envelope) });
}
const byChannel = new Map<string, V[]>();
for (const v of vids) {
  if (!byChannel.has(v.channel_id)) byChannel.set(v.channel_id, []);
  byChannel.get(v.channel_id)!.push(v);
}
const channelMedian = new Map<string, number>();
for (const [ch, list] of byChannel) {
  if (list.length >= 5) channelMedian.set(ch, Math.max(median(list.map((v) => v.day30)), 1));
}
const analyzable = vids.filter((v) => channelMedian.has(v.channel_id));
console.log(`Analyzable (channel has >=5 dense videos): ${analyzable.length}`);

// Early projection at day d: use only snapshots <= d
function earlyScore(v: V, d: number): number | null {
  const snaps = (snapsByVideo.get(v.id) || []).filter((s) => s.days_since_published <= d && s.days_since_published >= 0);
  if (!snaps.length) return null;
  const proj = day30Estimate(0, d, snaps, envelope);
  return proj / channelMedian.get(v.channel_id)!;
}

const OUTLIER = 3.0;
const FLAG = 2.0;
const days = [1, 2, 3, 5, 7, 14, 30];
const outliers = analyzable.filter((v) => v.day30 / channelMedian.get(v.channel_id)! >= OUTLIER);
const normals = analyzable.filter((v) => v.day30 / channelMedian.get(v.channel_id)! < 1.5);
console.log(`\nEventual outliers (>=${OUTLIER}x): ${outliers.length} (${((outliers.length / analyzable.length) * 100).toFixed(1)}%)`);

console.log('\nDetection rate of eventual outliers, by earliest sampling day (flag = early proj >= 2x):');
for (const d of days) {
  let detected = 0;
  let measurable = 0;
  for (const v of outliers) {
    const s = earlyScore(v, d);
    if (s === null) continue;
    measurable++;
    if (s >= FLAG) detected++;
  }
  let fp = 0;
  let fpMeasurable = 0;
  for (const v of normals) {
    const s = earlyScore(v, d);
    if (s === null) continue;
    fpMeasurable++;
    if (s >= FLAG) fp++;
  }
  console.log(
    `  day <= ${String(d).padStart(2)}: ${((detected / Math.max(measurable, 1)) * 100).toFixed(1)}% of outliers flagged` +
    ` (n=${measurable}); false-flag rate among normals: ${((fp / Math.max(fpMeasurable, 1)) * 100).toFixed(1)}% (n=${fpMeasurable})`
  );
}

// First-detectable-day distribution for outliers
const firstDay: number[] = [];
for (const v of outliers) {
  for (const d of days) {
    const s = earlyScore(v, d);
    if (s !== null && s >= FLAG) { firstDay.push(d); break; }
  }
}
firstDay.sort((a, b) => a - b);
const pct = (p: number) => firstDay[Math.floor((firstDay.length - 1) * p)] ?? -1;
console.log(`\nFirst-detectable day among eventually-detected outliers (n=${firstDay.length}):`);
console.log(`  p25=${pct(0.25)}  median=${pct(0.5)}  p75=${pct(0.75)}  p90=${pct(0.9)}`);
await pool.end();
