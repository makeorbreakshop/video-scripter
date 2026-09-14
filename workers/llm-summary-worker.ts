#!/usr/bin/env -S npx tsx
//
// The LLM summary worker. One worker, six profiles — replacing seven near-identical files.
//
// WHY THIS FILE EXISTS AS ONE FILE. workers/ held llm-summary-worker{,-fast,-450,-optimized,
// -optimized-io,-speed-optimized}.js: 2,177 lines that differed in four numbers (batch size,
// concurrency, target RPM, inter-batch delay) and in nothing else that mattered. Only
// -speed-optimized was wired to an npm script; the other five were dead. They were not
// harmless dead code, because each carried its own copy of the two queries below.
//
// THE BUG ALL SEVEN SHARED. Every variant decided what work was outstanding with
// `.is('llm_summary', null)` against `videos`. scripts/null-video-text.ts sets that column to
// NULL for the whole table. The next run would have found 1,118,401 videos "needing" a summary
// and re-billed every one of them against OpenAI — silently, because there is no error in
// re-summarising a video. The predicate now comes from lib/app/video-text.ts, which reads the
// side table (see needsSummaryBatchSql), and the summary is written to video_text, never back
// into `videos`.
//
// Usage:
//   npm run worker:llm-summary                       # the `speed` profile, as before
//   npx tsx workers/llm-summary-worker.ts --profile 450
//   npx tsx workers/llm-summary-worker.ts --batch 200 --concurrency 25 --rate 480
//   npx tsx workers/llm-summary-worker.ts --dry-run  # select and price the work, call nothing
//
// Everything the run needs — dotenv, supabase-js, openai, p-limit, pg — is imported inside
// main(). p-limit is ESM-only and openai pulls in a large graph; importing them at the top
// would make this module unloadable from the jest suite that pins the profile table and the
// prompt. The exported pure functions below are the part worth testing, so they stay reachable.
import { randomUUID } from 'node:crypto';

/**
 * The four numbers that were the only real difference between the seven files, named after the
 * variant each row came from so the history is recoverable without the deleted files.
 */
export interface Profile {
  batch: number;        // rows fetched per DB round trip
  concurrency: number;  // parallel OpenAI calls
  rate: number;         // target requests/minute (OpenAI's ceiling is 500)
  intervalMs: number;   // minimum spacing between batches, to cap IOPS
}

export const PROFILES: Record<string, Profile> = {
  // llm-summary-worker.js — serial, one request at a time.
  serial:       { batch: 50,  concurrency: 1,  rate: 400, intervalMs: 0 },
  // llm-summary-worker-fast.js
  fast:         { batch: 200, concurrency: 20, rate: 480, intervalMs: 0 },
  // llm-summary-worker-optimized.js
  optimized:    { batch: 200, concurrency: 25, rate: 480, intervalMs: 0 },
  // llm-summary-worker-optimized-io.js — smaller batches to stay off the IOPS ceiling.
  'low-io':     { batch: 100, concurrency: 10, rate: 400, intervalMs: 0 },
  // llm-summary-worker-450.js — the most aggressive one that ever ran.
  '450':        { batch: 450, concurrency: 50, rate: 450, intervalMs: 0 },
  // llm-summary-worker-speed-optimized.js — the profile npm run worker:llm-summary used.
  speed:        { batch: 100, concurrency: 15, rate: 450, intervalMs: 3000 },
};

export const DEFAULT_PROFILE = 'speed';

/** CLI over the profile table. Explicit flags win over the profile they are combined with. */
export function resolveProfile(argv: readonly string[]): Profile & { name: string } {
  const arg = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const name = arg('--profile') ?? DEFAULT_PROFILE;
  const base = PROFILES[name];
  if (!base) {
    throw new Error(`unknown --profile ${name}; one of: ${Object.keys(PROFILES).join(', ')}`);
  }
  const num = (f: string, d: number) => { const v = arg(f); return v === undefined ? d : Number(v); };
  const p = {
    name,
    batch: num('--batch', base.batch),
    concurrency: num('--concurrency', base.concurrency),
    rate: num('--rate', base.rate),
    intervalMs: num('--interval-ms', base.intervalMs),
  };
  for (const k of ['batch', 'concurrency', 'rate'] as const) {
    if (!Number.isFinite(p[k]) || p[k] < 1) throw new Error(`--${k} must be a positive number`);
  }
  if (p.rate > 500) throw new Error(`--rate ${p.rate} exceeds OpenAI's 500 req/min ceiling`);
  return p;
}

export const SYSTEM_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

export interface VideoRow { id: string; title: string | null; channel_name: string | null; description: string | null }

/** Byte-identical to the prompt all seven workers built, so summaries stay comparable. */
export function userPrompt(video: VideoRow): string {
  return `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description || 'No description available'}`;
}

/** Sliding-window limiter. Shared by every profile; only the ceiling differs. */
export function makeRateLimiter(perMinute: number, now: () => number = Date.now) {
  let stamps: number[] = [];
  return async function take(sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
    const t = now();
    stamps = stamps.filter((s) => t - s < 60_000);
    if (stamps.length >= perMinute) await sleep(60_000 - (t - stamps[0]) + 100);
    stamps.push(now());
  };
}

// ---- the run --------------------------------------------------------------------------

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);

async function main() {
  const p = resolveProfile(argv);
  const dry = has('--dry-run') || has('--dry');
  const { default: dotenv } = await import('dotenv');
  dotenv.config();
  dotenv.config({ path: '.env.local' });
  const { createClient } = await import('@supabase/supabase-js');
  const { default: OpenAI } = await import('openai');
  const { default: pLimit } = await import('p-limit');
  const { q } = await import('../lib/admin/db');
  const { needsSummaryBatchSql, NEEDS_SUMMARY_COUNT_SQL, writeLlmSummaries } =
    await import('../lib/app/video-text');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const gate = pLimit(p.concurrency);
  const rateLimit = makeRateLimiter(p.rate);

  const total = Number((await q<{ n: string }>(NEEDS_SUMMARY_COUNT_SQL))[0].n);
  console.log(`llm-summary-worker [${p.name}]: batch ${p.batch}, ${p.concurrency} parallel, ` +
              `${p.rate} req/min, ${p.intervalMs}ms between batches${dry ? ' [dry run]' : ''}`);
  console.log(`${total.toLocaleString()} video(s) need a summary — ` +
              `~${(total / p.rate / 60).toFixed(1)}h, ~$${(total * 0.000116).toFixed(2)}`);
  if (!total) return;
  if (dry) { console.log('dry run: nothing called, nothing written'); return; }

  const jobId = randomUUID();
  await supabase.from('jobs').insert({
    id: jobId, type: 'llm_summary', status: 'processing', created_at: new Date().toISOString(),
    data: { totalVideos: total, processed: 0, failed: 0, profile: p.name },
  });

  let cursor = '', done = 0, failed = 0, lastBatch = 0;
  const t0 = Date.now();
  try {
    for (;;) {
      const { data: control } = await supabase
        .from('worker_control').select('is_enabled').eq('worker_type', 'llm_summary').single();
      if (!control?.is_enabled) { console.log('worker_control disabled — stopping'); break; }

      if (p.intervalMs && lastBatch) {
        const wait = p.intervalMs - (Date.now() - lastBatch);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      lastBatch = Date.now();

      const videos = await q<VideoRow>(needsSummaryBatchSql(), [cursor, p.batch]);
      if (!videos.length) { console.log('nothing left to summarise'); break; }

      const written: { videoId: string; llmSummary: string }[] = [];
      await Promise.all(videos.map((v) => gate(async () => {
        try {
          await rateLimit();
          const res = await openai.chat.completions.create({
            model: 'gpt-4o-mini', temperature: 0.3, max_tokens: 100,
            messages: [{ role: 'system', content: SYSTEM_PROMPT },
                       { role: 'user', content: userPrompt(v) }],
          });
          const summary = res.choices[0]?.message?.content?.trim();
          if (summary) { written.push({ videoId: v.id, llmSummary: summary }); done++; }
        } catch (e: any) {
          failed++;
          if (e?.status === 429) await new Promise((r) => setTimeout(r, 10_000));
          console.error(`failed ${v.id}: ${e?.message ?? e}`);
        }
      })));

      // The summary goes to video_text. The two bookkeeping columns stay on `videos`: they are
      // not part of the move and the vectorization worker and the progress routes read them.
      if (written.length) {
        await writeLlmSummaries(written);
        await supabase.from('videos').upsert(
          written.map((w) => ({
            id: w.videoId,
            llm_summary_generated_at: new Date().toISOString(),
            llm_summary_model: 'gpt-4o-mini',
          })), { onConflict: 'id' });
      }

      cursor = videos[videos.length - 1].id;
      const mins = (Date.now() - t0) / 60_000;
      console.log(`  ${done.toLocaleString()}/${total.toLocaleString()} · ${failed} failed · ` +
                  `${(done / Math.max(mins, 0.01)).toFixed(0)}/min · at '${cursor}'`);
      await supabase.from('jobs').update({ data: { totalVideos: total, processed: done, failed, profile: p.name } }).eq('id', jobId);
    }
  } finally {
    await supabase.from('jobs').update({
      status: 'completed', completed_at: new Date().toISOString(),
      data: { processed: done, failed, durationMs: Date.now() - t0, profile: p.name },
    }).eq('id', jobId);
    console.log(`done: ${done.toLocaleString()} summarised, ${failed} failed, ${((Date.now() - t0) / 60_000).toFixed(1)} min`);
  }
}

// Importable for the tests without running the loop.
if (process.argv[1] && process.argv[1].includes('llm-summary-worker')) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
