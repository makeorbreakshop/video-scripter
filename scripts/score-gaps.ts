// Why long-form videos under 90 days have no score. Read-only; direct Postgres.
//   npx tsx scripts/score-gaps.ts [--days 90]
//
// Prints one row per cause (lib/scoring/score-gaps.ts names them), with an age breakdown, and
// says which causes a run of an existing job would close. Nothing here writes.
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import pg from 'pg';
import { longformSql } from '../lib/scoring/longform';
import { gapBucket, isFixable, GAP_BUCKETS, type GapBucket, type GapFacts } from '../lib/scoring/score-gaps';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const DAYS = Number(arg('--days') ?? 90);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('connect', (c: pg.PoolClient) => { c.query('set statement_timeout = 600000').catch(() => {}); });

// One pass: every long-form video in the window, with the four facts the bucketing needs.
// The counts are subqueries rather than joins so a video with 3,000 samples costs the same
// as one with none (each is an index-only count), and nothing fans out.
const sql = `
with gap as (
  select v.id, v.channel_id, v.channel_name, v.published_at,
         extract(epoch from (now() - v.published_at))/86400.0 as age_days,
         coalesce(v.view_count, 0)::bigint as view_count,
         sc.video_id is not null as has_row,
         sc.score::float8 as score,
         coalesce(sc.n_baseline, 0)::int as n_baseline
    from videos v
    left join video_scores sc on sc.video_id = v.id
   where v.published_at > now() - ($1 || ' days')::interval
     and ${longformSql('v')}
     and (sc.video_id is null or sc.score is null)
)
select g.id, g.channel_name, g.age_days, g.view_count, g.has_row, g.score, g.n_baseline,
       (select count(*) from view_snapshots s where s.video_id = g.id)
     + (select count(*) from view_samples s where s.video_id = g.id) as observations,
       (select count(*) from videos p
         where p.channel_id = g.channel_id and p.published_at < g.published_at
           and ${longformSql('p')}
           and coalesce(p.privacy_status,'public') = 'public'
           and coalesce(p.view_count,0) > 0) as prior_longform
  from gap g`;

const total = (await pool.query(
  `select count(*)::int n from videos v
    where v.published_at > now() - ($1 || ' days')::interval and ${longformSql('v')}`, [DAYS]
)).rows[0].n;

const rows = (await pool.query(sql, [DAYS])).rows as any[];

type Tally = { n: number; under7: number; under30: number; examples: string[] };
const tally = new Map<GapBucket, Tally>();
for (const b of GAP_BUCKETS) tally.set(b, { n: 0, under7: 0, under30: 0, examples: [] });

for (const r of rows) {
  const f: GapFacts = {
    ageDays: Number(r.age_days),
    hasScoreRow: r.has_row,
    score: r.score === null ? null : Number(r.score),
    nBaseline: Number(r.n_baseline),
    observations: Number(r.observations),
    priorLongform: Number(r.prior_longform),
    viewCount: Number(r.view_count),
  };
  const b = gapBucket(f);
  if (!b) continue;
  const t = tally.get(b)!;
  t.n++;
  if (f.ageDays < 7) t.under7++;
  if (f.ageDays < 30) t.under30++;
  if (t.examples.length < 3) t.examples.push(`${r.id} (${r.channel_name ?? '?'}, ${f.ageDays.toFixed(1)}d)`);
}

const gaps = [...tally.values()].reduce((a, t) => a + t.n, 0);
const pad = (s: string, n: number) => s.padEnd(n);
const num = (n: number) => String(n).padStart(7);

console.log(`\nlong-form videos published in the last ${DAYS} days: ${total}`);
console.log(`with no score: ${gaps} (${((gaps / total) * 100).toFixed(1)}%) — coverage ${(100 - (gaps / total) * 100).toFixed(1)}%\n`);
console.log(`${pad('bucket', 24)}${num(0).replace('0', 'count')}${num(0).replace('0', '<7d')}${num(0).replace('0', '<30d')}  fixable  example`);
console.log('-'.repeat(100));
for (const b of GAP_BUCKETS) {
  const t = tally.get(b)!;
  if (!t.n) continue;
  console.log(`${pad(b, 24)}${num(t.n)}${num(t.under7)}${num(t.under30)}  ${isFixable(b) ? 'yes    ' : 'no     '}  ${t.examples[0] ?? ''}`);
}
const fixable = GAP_BUCKETS.filter(isFixable).reduce((a, b) => a + tally.get(b)!.n, 0);
console.log('-'.repeat(100));
console.log(`fixable by a run: ${fixable}   genuinely too little data: ${gaps - fixable}\n`);
for (const b of GAP_BUCKETS) {
  const t = tally.get(b)!;
  if (t.n) console.log(`${b}: ${t.examples.join(', ')}`);
}
console.log();
await pool.end();
