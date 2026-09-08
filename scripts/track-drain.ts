// Everything a newly tracked channel needs, on a schedule: back-catalog jobs, channel identity,
// final scores for its older videos, fresh scores for its recent ones. Idempotent; paced by the
// scripts it calls. Runs every 15 minutes via com.mfm.video-scripter-track-drain.
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { longformSql } from '../lib/scoring/longform';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const run = (args: string[]) => { console.log('>', args.join(' ')); try { console.log(execFileSync('npx', ['tsx', ...args], { encoding: 'utf8', timeout: 20 * 60_000 }).trim().split('\n').slice(-2).join('\n')); } catch (e: any) { console.error('failed:', (e.stdout || '').toString().slice(-300), (e.stderr || '').toString().slice(-300)); } };
// 1. the due view-tracking queue: everything whose next_track_at has come round, inside this
//    tick's slice of the day's quota. Replaced the 3 AM nightly on 2026-09-05 — a video is now
//    read on its own clock (last read + its age tier's interval), not on a batch boundary.
// Two passes over the same due queue, both on the MAIN project: the stats endpoint's own
// allowance and the main key's spare. The second project's key is a FAILOVER ONLY — YouTube's
// API Services policies forbid using multiple projects to extend quota (reverted 2026-09-06).
run(['scripts/track-due.ts', '--pool', 'batch', '--budget', '5000', '--deadline-ms', '300000']);
run(['scripts/track-due.ts', '--pool', 'main', '--budget', '3000', '--deadline-ms', '300000']);
// 2. catalogs for queued jobs (budgeted inside the script)
run(['scripts/backfill-catalog.ts', '--budget', '3000', '--jobs', '60']); // main key; the library catch-up rides this queue
// 3. channel identity for any tracked channel missing it
run(['scripts/channel-meta-backfill.ts']);
// 4. scores: user-lane channels whose videos older than 60d have no final score yet.
//
// This EXISTS was the second most expensive statement in the database per call: 34,578 shared
// blocks and 24 s, every fifteen minutes. The reason is the channels that are already FULLY
// scored — for those the subquery has to examine every video in the catalogue before it can
// answer "no", and there is no index that can shortcut an anti-join against another table.
//
// So the sweep is bounded instead of exhaustive: a channel is examined at most once a day, and
// each run looks at CANDIDATES of them (oldest check first) rather than all of the user lane.
// The work still gets done — a channel with unscored videos is picked up within a day and then
// scored on every run until it is clean — and the per-run cost is bounded by CANDIDATES.
const CANDIDATES = 20;
const candidates = (await pool.query<{ channel_id: string }>(
  `select channel_id from channel_tracking
    where lane = 'user'
      and (unscored_checked_at is null or unscored_checked_at < now() - interval '1 day')
    order by unscored_checked_at nulls first
    limit $1`, [CANDIDATES])).rows.map((r) => r.channel_id);

const rows = candidates.length ? (await pool.query<{ channel_id: string }>(
  `select ct.channel_id from channel_tracking ct
    where ct.channel_id = any($1::text[])
      and exists (select 1 from videos v where v.channel_id = ct.channel_id and v.published_at < now() - interval '60 days'
                    and ${longformSql('v')} and not exists (select 1 from video_scores s where s.video_id = v.id))
    limit 5`, [candidates])).rows : [];

// Stamp everything examined, clean or not, so the next run moves on to a different slice.
if (candidates.length) {
  await pool.query(
    `update channel_tracking set unscored_checked_at = now() where channel_id = any($1::text[])`,
    [candidates]);
}

if (rows.length) {
  const ids = rows.map((r) => r.channel_id).join(',');
  run(['scripts/score-videos.ts', '--final', '--channels', ids]);
  run(['scripts/score-videos.ts', '--channels', ids]);
}
await pool.end(); console.log('track-drain done');
