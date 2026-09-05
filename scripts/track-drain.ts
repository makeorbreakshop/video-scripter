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
run(['scripts/track-due.ts', '--budget', '5000']); // self-budgeting; bounded to ~5 min so it cannot overrun the tick
// 2. catalogs for queued jobs (budgeted inside the script)
run(['scripts/backfill-catalog.ts', '--budget', '9800', '--jobs', '120']); // its own 10K bucket (YOUTUBE_API_KEY_BACKUP) // gap-year catch-up for legacy channels rides this queue
// 3. channel identity for any tracked channel missing it
run(['scripts/channel-meta-backfill.ts']);
// 4. scores: user-lane channels whose videos older than 60d have no final score yet
const { rows } = await pool.query(
  `select ct.channel_id from channel_tracking ct where ct.lane = 'user'
     and exists (select 1 from videos v where v.channel_id = ct.channel_id and v.published_at < now() - interval '60 days'
                   and ${longformSql('v')} and not exists (select 1 from video_scores s where s.video_id = v.id))
   limit 5`);
if (rows.length) {
  const ids = rows.map((r) => r.channel_id).join(',');
  run(['scripts/score-videos.ts', '--final', '--channels', ids]);
  run(['scripts/score-videos.ts', '--channels', ids]);
}
await pool.end(); console.log('track-drain done');
