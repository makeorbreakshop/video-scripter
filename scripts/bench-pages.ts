// Page benchmark: what each page actually costs the database.
//
// WHY BLOCKS, NOT SECONDS. This database is disk-bound (512 MB shared_buffers against ~10 GB of
// data), so wall time is mostly a function of how many of a page's blocks happen to be in cache
// at that moment — the same page measured twice can differ 5x with no code change. The stable
// number is how many 8 KB blocks the page touched: shared_blks_read (came off disk) plus
// shared_blks_hit (came out of shared_buffers). Blocks are the primary metric here; wall is
// reported second and should be read as a range, not a measurement.
//
// HOW THE DELTA IS ATTRIBUTED. pg_stat_statements has no pid, and the pipeline jobs run as
// `postgres` the whole time, so a plain delta would attribute the hourly scorer to whatever page
// happened to be loading. The dev server is therefore pointed at the channelsmith_app role
// (DATABASE_POOLER_URL from ~/.channelsmith_app_url, never printed), and the delta is filtered to
// that role's rows — which nothing but the app can write. pg_stat_activity is sampled around each
// run anyway, and a run overlapping a long-running query is flagged in the output.
//
// CACHES ARE BYPASSED. The dev server runs with BENCH=1, which makes lib/app/cached.ts call the
// uncached functions directly (see the comment there). Two measured runs per URL, after a
// discarded priming run that pays for dev-mode compilation.
//
// Usage:
//   npx tsx scripts/bench-pages.ts --out docs/benchmarks/pages-2026-09-08-before
//   npx tsx scripts/bench-pages.ts --label after --out docs/benchmarks/pages-2026-09-08-after
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const arg = (f: string, d?: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const has = (f: string) => args.includes(f);

const OUT = arg('--out', 'docs/benchmarks/pages-' + new Date().toISOString().slice(0, 10) + '-before')!;
const LABEL = arg('--label', 'before')!;
const RUNS = Number(arg('--runs', '2'));
const APP_ROLE = arg('--role', 'channelsmith_app')!;

/** The pages, and the ids they are pinned to. Fixed on purpose: a benchmark that picks different
 *  videos each run measures the corpus, not the code. */
const CHANNELS = [
  { id: 'UCjWkNxpp3UHdEavpM_19--Q', note: 'Make or Break Shop (245 videos)' },
  { id: 'UCGhyz7J9HmS0GT8Y_BR_crA', note: 'wittworks (62 videos)' },
  { id: 'UCBJycsmduvYEL83R_U4JriQ', note: 'Marques Brownlee (1745 videos)' },
];

interface Target { name: string; url: string; note?: string }

function targets(videoIds: string[]): Target[] {
  return [
    { name: 'feed/all', url: '/app/feed' },
    { name: 'feed/outliers', url: '/app/feed?seg=outliers' },
    { name: 'feed/tests', url: '/app/feed?seg=tests' },
    { name: 'feed/uploads', url: '/app/feed?seg=uploads' },
    { name: 'channels', url: '/app/channels' },
    ...CHANNELS.map((c) => ({ name: `channel/${c.id}`, url: `/app/channels/${c.id}`, note: c.note })),
    ...videoIds.map((v) => ({ name: `video/${v}`, url: `/app/videos/${v}` })),
  ];
}

// ---------------------------------------------------------------- pg_stat_statements deltas

interface Stat { queryid: string; calls: number; ms: number; read: number; hit: number; q: string }
type Snap = Map<string, Stat>;

const SNAP_SQL = `
  select queryid::text as queryid, calls, total_exec_time as ms,
         shared_blks_read as read, shared_blks_hit as hit,
         left(regexp_replace(query, '\\s+', ' ', 'g'), 160) as q
    from pg_stat_statements
   where userid = (select oid from pg_roles where rolname = $1)`;

async function snapshot(c: pg.Client): Promise<Snap> {
  const r = await c.query(SNAP_SQL, [APP_ROLE]);
  return new Map(r.rows.map((x: any) => [x.queryid, {
    queryid: x.queryid, calls: Number(x.calls), ms: Number(x.ms),
    read: Number(x.read), hit: Number(x.hit), q: x.q,
  }]));
}

function delta(a: Snap, b: Snap): Stat[] {
  const out: Stat[] = [];
  for (const [id, x] of b) {
    const y = a.get(id);
    const calls = x.calls - (y?.calls ?? 0);
    if (calls <= 0) continue;
    out.push({ queryid: id, calls, ms: x.ms - (y?.ms ?? 0), read: x.read - (y?.read ?? 0), hit: x.hit - (y?.hit ?? 0), q: x.q });
  }
  return out.sort((p, q2) => (q2.read + q2.hit) - (p.read + p.hit));
}

/** Anything that has been running long enough to be a heavy pipeline job, not a page. */
async function busy(c: pg.Client): Promise<string[]> {
  const r = await c.query(
    `select left(regexp_replace(query,'\\s+',' ','g'), 80) as q
       from pg_stat_activity
      where state = 'active' and pid <> pg_backend_pid()
        and now() - query_start > interval '5 seconds'
        and query not ilike '%pg_stat_%'`);
  return r.rows.map((x: any) => x.q);
}

// ---------------------------------------------------------------- dev server

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, () => { const p = (s.address() as any).port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

async function waitReady(url: string, ms = 180_000) {
  const t0 = Date.now();
  for (;;) {
    try { const r = await fetch(url, { redirect: 'manual' }); if (r.status) return; } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error('dev server did not come up');
    await new Promise((r) => setTimeout(r, 500));
  }
}

function startDev(port: number, appUrl: string | null): ChildProcess {
  const env: NodeJS.ProcessEnv = { ...process.env, BENCH: '1', PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' };
  if (appUrl) env.DATABASE_POOLER_URL = appUrl;
  const child = spawn('npx', ['next', 'dev', '-p', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (d) => { if (has('--verbose')) process.stdout.write(`[dev] ${d}`); });
  child.stderr?.on('data', (d) => { if (has('--verbose')) process.stderr.write(`[dev] ${d}`); });
  return child;
}

// ---------------------------------------------------------------- main

interface RunResult { wallMs: number; status: number; dbMs: number; read: number; hit: number; top: Stat[]; busy: string[] }
interface PageResult { name: string; url: string; note?: string; runs: RunResult[] }

const appUrlPath = path.join(homedir(), '.channelsmith_app_url');
let appUrl: string | null = null;
try { appUrl = readFileSync(appUrlPath, 'utf8').trim() || null; } catch { appUrl = null; }
if (!appUrl) console.warn(`! ${appUrlPath} unreadable — the dev server will connect as the default role and the delta will include pipeline traffic`);

const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();

// Videos: recent, scored, on the benchmark channels — pinned by id in the output so a later run
// measures the same pages.
const videoIds: string[] = arg('--videos')
  ? arg('--videos')!.split(',')
  : (await admin.query(
      `select v.id from videos v join video_scores s on s.video_id = v.id
        where v.channel_id = any($1) and v.published_at is not null
        order by v.published_at desc limit 4`, [CHANNELS.map((c) => c.id)])).rows.map((r: any) => r.id);

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const cookie = `cs_preview=${process.env.CS_PREVIEW_TOKEN ?? ''}`;
console.log(`bench: dev server on ${port}, ${videoIds.length} video page(s), role filter ${APP_ROLE}`);

const dev = startDev(port, appUrl);
const stop = () => { try { dev.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

const results: PageResult[] = [];
try {
  await waitReady(`${base}/app/feed`);

  for (const t of targets(videoIds)) {
    const url = base + t.url;
    // Priming run: pays dev-mode compilation, warms nothing that matters (caches are bypassed).
    await fetch(url, { headers: { cookie } }).then((r) => r.text()).catch(() => '');
    const runs: RunResult[] = [];
    for (let i = 0; i < RUNS; i++) {
      const before = await snapshot(admin);
      const t0 = Date.now();
      const res = await fetch(url, { headers: { cookie } });
      await res.text();
      const wallMs = Date.now() - t0;
      const after = await snapshot(admin);
      const d = delta(before, after);
      runs.push({
        wallMs, status: res.status,
        dbMs: Math.round(d.reduce((s, x) => s + x.ms, 0)),
        read: d.reduce((s, x) => s + x.read, 0),
        hit: d.reduce((s, x) => s + x.hit, 0),
        top: d.slice(0, 3),
        busy: await busy(admin),
      });
    }
    results.push({ name: t.name, url: t.url, note: t.note, runs });
    const b = runs.map((r) => r.read + r.hit);
    console.log(`  ${t.name.padEnd(34)} blocks ${b.join(' / ')}  wall ${runs.map((r) => r.wallMs).join(' / ')}ms  http ${runs[0].status}`);
  }
} finally { stop(); }

const payload = {
  label: LABEL, at: new Date().toISOString(), role: APP_ROLE, runs: RUNS,
  videoIds, channels: CHANNELS, results,
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(`${OUT}.json`, JSON.stringify(payload, null, 2));

const min = (r: PageResult, f: (x: RunResult) => number) => Math.min(...r.runs.map(f));
const md = [
  `# Page benchmark — ${LABEL} (${payload.at})`,
  '',
  'Blocks = shared_blks_read + shared_blks_hit for the channelsmith_app role, delta around one',
  'request, caches bypassed (BENCH=1). Blocks is the primary metric; wall time on this instance',
  'moves with whatever else is touching the disk. Best of ' + RUNS + ' runs.',
  '',
  '| page | blocks | disk blocks | db ms | wall ms | top statement |',
  '|---|---:|---:|---:|---:|---|',
  ...results.map((r) => {
    const best = r.runs.reduce((a, b) => (a.read + a.hit <= b.read + b.hit ? a : b));
    return `| ${r.name} | ${best.read + best.hit} | ${best.read} | ${best.dbMs} | ${min(r, (x) => x.wallMs)} | ${(best.top[0]?.q ?? '').slice(0, 70)} |`;
  }),
  '',
  '## Top statements per page',
  ...results.flatMap((r) => {
    const best = r.runs.reduce((a, b) => (a.read + a.hit <= b.read + b.hit ? a : b));
    return ['', `### ${r.name}${r.note ? ` — ${r.note}` : ''}`, '',
      ...best.top.map((s) => `- ${s.calls} call(s), ${Math.round(s.ms)} ms, ${s.read + s.hit} blocks (${s.read} from disk): \`${s.q.slice(0, 140)}\``)];
  }),
  '',
].join('\n');
writeFileSync(`${OUT}.md`, md);
console.log(`wrote ${OUT}.json and ${OUT}.md`);
await admin.end();
