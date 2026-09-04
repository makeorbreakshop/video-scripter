/** Resumable replacement for the ad-hoc corpus loop; shares the scorer lease with hourly work. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { startManagedJob } from '../lib/nightly/job-lifecycle';
import { runBackfillLoop, type BackfillPassResult } from '../lib/scoring/backfill-loop';

const value = (name: string) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i+1];
};
const checkpoint = path.resolve(value('--checkpoint') ?? 'tmp/score-backfill-v5.1-rss.json');
const maxPasses = Number(value('--max-passes') ?? 200);
if (!Number.isInteger(maxPasses) || maxPasses < 1) throw new Error('max-passes must be positive');
const childArgs = [...process.execArgv, 'scripts/score-videos.ts', '--all', '--limit', '20000',
  '--max-seconds', '2700', '--checkpoint', checkpoint];
if (process.argv.includes('--dry-run')) {
  console.log({ command: process.execPath, args: childArgs, maxPasses, busyWaitSeconds: 60, betweenPassSeconds: 3600 });
  process.exit(0);
}
const job = startManagedJob({ name: 'score-backfill-loop', args: ['--max-seconds', '259200'] });
if (!job.acquired) process.exit(0);
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
const complete = () => {
  try { return JSON.parse(fs.readFileSync(checkpoint, 'utf8')).complete === true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};
async function runPass(): Promise<BackfillPassResult> {
  if (complete()) return 'complete';
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, childArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '', busy = false;
    const stop = () => { child.kill('SIGTERM'); };
    job.signal.addEventListener('abort', stop, { once: true });
    if (job.signal.aborted) stop();
    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      tail = (tail + chunk.toString()).slice(-4096);
      busy ||= tail.includes('[job:score-videos] already running');
    });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.once('error', error => { job.signal.removeEventListener('abort', stop); reject(error); });
    child.once('close', code => {
      job.signal.removeEventListener('abort', stop);
      if (busy) resolve('busy');
      else if (code !== 0) { log(`backfill pass exited ${code}; retaining checkpoint`); resolve('failed'); }
      else {
        try { resolve(complete() ? 'complete' : 'progress'); }
        catch (error) { reject(error); }
      }
    });
  });
}
try {
  const result = await runBackfillLoop({
    maxPasses, signal: job.signal, runPass,
    wait: async milliseconds => {
      log(`backfill waiting ${milliseconds/1000}s; hourly scorer retains its own schedule`);
      await delay(milliseconds, undefined, { signal: job.signal }).catch(error => {
        if (error.name !== 'AbortError') throw error;
      });
    },
  });
  log(`backfill loop ${result}; checkpoint ${checkpoint}`);
} finally { job.finish(); }
