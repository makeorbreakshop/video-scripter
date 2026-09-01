// Health endpoint for the standalone nightly pipeline (LaunchAgents + direct Postgres).
// Reads launchd logs from disk and counts from the DB over DATABASE_URL — no supabase-js,
// per the 2026-08-31 egress incident rules. Pool is lazy so builds never open a connection.
import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import pg from 'pg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let pool: pg.Pool | null = null;
function getPool() {
  if (!pool) pool = new pg.Pool({ connectionString: process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL, max: 2 });
  return pool;
}

const LOGS: { job: string; file: string }[] = [
  { job: 'ingest', file: 'daily-ingest-launchd.log' },
  { job: 'view tracking', file: 'view-tracking-launchd.log' },
  { job: 'thumbnail watch', file: 'thumbnail-watch-launchd.log' },
  { job: 'touch drain', file: 'touch-drain-launchd.log' },
];

async function readLog(file: string, lines = 20) {
  const full = path.join(process.cwd(), 'logs', file);
  try {
    const [stat, text] = await Promise.all([fs.stat(full), fs.readFile(full, 'utf8')]);
    const err = await fs
      .readFile(full.replace('.log', '.err.log'), 'utf8')
      .then((t) => t.trim())
      .catch(() => '');
    return {
      mtime: stat.mtime.toISOString(),
      tail: text.trim().split('\n').slice(-lines),
      errTail: err ? err.split('\n').slice(-lines) : [],
    };
  } catch {
    return { mtime: null, tail: [], errTail: [] };
  }
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export async function GET() {
  const db = getPool();
  try {
    const [snapshots, ingested, thumbDays, thumbTotals, quota, quotaLedger, logs] =
      await Promise.all([
        db.query(
          `select snapshot_date::text as day, count(*)::int as n
           from view_snapshots where snapshot_date >= current_date - 13
           group by 1 order by 1`
        ),
        db.query(
          `select import_date::date::text as day, count(*)::int as n
           from videos where import_date >= current_date - 13
           group by 1 order by 1`
        ),
        db.query(
          `select first_seen::date::text as day,
                  count(*) filter (where version > 1)::int as changes,
                  count(*) filter (where version = 1)::int as captures
           from thumbnail_versions
           where first_seen >= current_date - 13
           group by 1 order by 1`
        ),
        db.query(
          `select
             count(distinct video_id)::int as watched,
             count(*) filter (where last_checked >= now() - interval '24 hours')::int as checked_24h
           from thumbnail_versions`
        ),
        db.query(`select quota_used::int from youtube_quota_usage where date = current_date`),
        db.query(
          `select category, sum(units)::int as units from quota_ledger
           where date = current_date group by category order by units desc`
        ),
        Promise.all(LOGS.map(async (l) => ({ job: l.job, ...(await readLog(l.file)) }))),
      ]);

    const today = new Date().toISOString().split('T')[0];
    const dayN = (rows: { day: string; n: number }[], day: string) =>
      rows.find((r) => r.day === day)?.n ?? 0;

    const snapToday = dayN(snapshots.rows, today);
    const ingestToday = dayN(ingested.rows, today);
    const thumbToday = thumbDays.rows.find((r) => r.day === today);
    const tt = thumbTotals.rows[0];

    const logFor = (job: string) => logs.find((l) => l.job === job);
    const freshWithin = (job: string, hours: number) => {
      const m = logFor(job)?.mtime;
      return !!m && Date.now() - new Date(m).getTime() < hours * 3600_000;
    };

    // A job is "attention" when it hasn't produced output on schedule or its err log is non-empty.
    const jobs = [
      {
        job: 'ingest',
        ok: freshWithin('ingest', 26) && ingestToday > 0,
        lastRun: logFor('ingest')?.mtime ?? null,
        today: ingestToday,
        unit: 'videos',
        series: ingested.rows,
      },
      {
        job: 'view tracking',
        ok: freshWithin('view tracking', 26) && snapToday > 0,
        lastRun: logFor('view tracking')?.mtime ?? null,
        today: snapToday,
        unit: 'snapshots',
        series: snapshots.rows,
      },
      {
        job: 'thumbnail watch',
        ok: tt.checked_24h > 0,
        lastRun: logFor('thumbnail watch')?.mtime ?? null,
        today: thumbToday?.changes ?? 0,
        unit: 'changes',
        series: thumbDays.rows.map((r) => ({ day: r.day, n: r.changes })),
      },
      {
        job: 'touch drain',
        ok: freshWithin('touch drain', 26),
        lastRun: logFor('touch drain')?.mtime ?? null,
        today: null,
        unit: null,
        series: [],
      },
    ].map((j) => {
      const errTail = logFor(j.job)?.errTail ?? [];
      const past = j.series.filter((r) => r.day !== today).map((r) => r.n);
      const med = median(past);
      // Volume anomaly: today's output wildly off the recent median (ingest/tracking only).
      const anomaly =
        j.today !== null && med > 0 && (j.job === 'ingest' || j.job === 'view tracking')
          ? j.today > med * 3 || j.today < med * 0.25
          : false;
      return { ...j, hasErrors: errTail.length > 0, median: med, anomaly };
    });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      jobs,
      thumbnails: {
        watched: tt.watched,
        checked24h: tt.checked_24h,
        capturesToday: thumbToday?.captures ?? 0,
        changesToday: thumbToday?.changes ?? 0,
        days: thumbDays.rows,
      },
      quota: {
        usedToday: quota.rows[0]?.quota_used ?? 0,
        limit: 10000,
        ledger: quotaLedger.rows,
      },
      logs,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown error' },
      { status: 500 }
    );
  }
}
