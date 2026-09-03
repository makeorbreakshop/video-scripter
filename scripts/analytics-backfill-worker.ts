// Drains the owner-analytics onboarding queue at a paced rate.
//
// Connecting a channel enqueues a job (lib/app/backfill-jobs.ts); this imports its history in
// windows, oldest first, staying under the project's Analytics API ceilings
// (lib/app/analytics-queue.ts). Resumable: progress is saved per window, so stopping on
// budget, on a crash, or on Ctrl-C loses at most one window.
//
//   npx tsx scripts/analytics-backfill-worker.ts              # drain until empty or budget spent
//   npx tsx scripts/analytics-backfill-worker.ts --once       # one job then exit
//   npx tsx scripts/analytics-backfill-worker.ts --dry
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' }); dotenv.config({ path: '.env' });

const { q, getPool } = await import('../lib/admin/db');
const { claimNextJob, saveProgress, WINDOW_DAYS } = await import('../lib/app/backfill-jobs');
const { planWindows, estimateQueries, Pacer, DAILY_QUERY_BUDGET } = await import('../lib/app/analytics-queue');
const { accessTokenFromRefresh, fetchDaily, saveDaily, markSynced } = await import('../lib/app/youtube-connect');
const { decryptSecret } = await import('../lib/app/crypto');

const dry = process.argv.includes('--dry');
const once = process.argv.includes('--once');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Analytics queries already spent today, so a restarted worker does not double-spend. */
async function spentToday(): Promise<number> {
  const rows = await q<{ n: number }>(
    `select coalesce(sum(units),0)::int as n from quota_ledger where date = current_date and category = 'analytics'`
  );
  return Number(rows[0]?.n ?? 0);
}

async function logAnalytics(n: number) {
  if (dry || n <= 0) return;   // a dry run spends nothing, so it must record nothing
  await q(`insert into quota_ledger (category, units) values ('analytics', $1)`, [n]).catch(() => {});
}

const pacer = new Pacer(Date.now, await spentToday());
console.log(`analytics queries already spent today: ${pacer.today} / ${DAILY_QUERY_BUDGET}`);

let jobs = 0;
while (!pacer.exhausted()) {
  const job = await claimNextJob();
  if (!job) { console.log('queue empty'); break; }
  jobs++;

  const conn = await q<{ refresh_token: string; channel_title: string }>(
    `select refresh_token, channel_title from youtube_connections where user_id = $1 and channel_id = $2`,
    [job.user_id, job.channel_id]
  );
  if (!conn[0]) {
    await saveProgress(job.id, { status: 'failed', error: 'the channel was disconnected' });
    continue;
  }
  const label = conn[0].channel_title || job.channel_id;

  if (!job.first_date || !job.last_date) {
    await saveProgress(job.id, { status: 'done', error: null });
    console.log(`${label}: nothing to import (no videos)`);
    continue;
  }

  const vids = (await q<{ id: string }>(`select id from videos where channel_id = $1`, [job.channel_id])).map((v) => v.id);
  const windows = planWindows(job.cursor_date || job.first_date, job.last_date, WINDOW_DAYS);
  console.log(`${label}: ${windows.length} window(s) left, ${vids.length} videos, ~${windows.length * estimateQueries(vids.length, WINDOW_DAYS)} queries`);

  let token = '';
  try { token = await accessTokenFromRefresh(decryptSecret(conn[0].refresh_token)); }
  catch (e: any) {
    await saveProgress(job.id, { status: 'failed', error: `could not refresh the connection: ${e.message}`.slice(0, 280) });
    await markSynced(job.user_id, job.channel_id, e.message.slice(0, 300));
    continue;
  }

  let done = job.windows_done;
  let stopped = false;
  for (const w of windows) {
    const per = Math.max(1, Math.floor((10_000 * 0.9) / (WINDOW_DAYS + 1)));
    const calls = Math.ceil(vids.length / per);
    if (pacer.exhausted()) { stopped = true; break; }
    const wait = pacer.waitMs(calls);
    if (wait > 0) { console.log(`  pacing: waiting ${Math.round(wait / 1000)}s`); await sleep(wait); }

    let rows = 0;
    try {
      for (let i = 0; i < vids.length; i += per) {
        const batch = vids.slice(i, i + per);
        const got = dry ? [] : await fetchDaily(token, batch, w.from, w.to);
        rows += dry ? 0 : await saveDaily(got, job.channel_id);
      }
    } catch (e: any) {
      if (!dry) await saveProgress(job.id, { status: 'queued', error: e.message.slice(0, 280) });
      console.error(`  ${w.from}..${w.to} failed: ${e.message}`);
      stopped = true;
      break;
    }
    await logAnalytics(calls);
    done++;
    const next = new Date(new Date(`${w.to}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
    if (!dry) await saveProgress(job.id, { cursor_date: next, windows_done: done, rows_written: rows, queries_spent: calls, error: null });
    console.log(`  ${w.from}..${w.to}: ${rows} rows`);
  }

  if (dry) {
    // Leave the job exactly as found: a dry run must never advance or complete it.
    await saveProgress(job.id, { status: 'queued' });
    console.log(`${label}: dry run, job left queued`);
  } else if (!stopped) {
    await saveProgress(job.id, { status: 'done', windows_done: done, error: null });
    await markSynced(job.user_id, job.channel_id, null);
    console.log(`${label}: history imported`);
  } else {
    await saveProgress(job.id, { status: 'queued', windows_done: done });
    console.log(`${label}: paused, will resume`);
  }
  if (once) break;
}

console.log(`done: ${jobs} job(s), ${pacer.today} analytics queries spent today`);
await getPool().end();
