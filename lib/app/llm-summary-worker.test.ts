// The kept worker's read path and its profile table.
//
// Seven workers became one. These tests pin the two properties that made the seven dangerous:
// the "needs a summary" predicate must not come from videos.llm_summary (it is about to be
// NULL for every row), and the prompt must be byte-identical to the one the deleted workers
// built, so the summaries already in the corpus stay comparable with the ones still to come.
import {
  PROFILES, DEFAULT_PROFILE, resolveProfile, userPrompt, SYSTEM_PROMPT, makeRateLimiter,
} from '../../workers/llm-summary-worker';
import { needsSummaryBatchSql, NEEDS_SUMMARY_COUNT_SQL } from './video-text';

describe('the profile table', () => {
  it('keeps a profile for each of the six deleted variants', () => {
    expect(Object.keys(PROFILES).sort())
      .toEqual(['450', 'fast', 'low-io', 'optimized', 'serial', 'speed'].sort());
  });

  it('defaults to the one profile that was actually wired to an npm script', () => {
    // package.json ran workers/llm-summary-worker-speed-optimized.js. Its four numbers.
    expect(DEFAULT_PROFILE).toBe('speed');
    expect(PROFILES.speed).toEqual({ batch: 100, concurrency: 15, rate: 450, intervalMs: 3000 });
  });

  it('lets an explicit flag override the profile it is combined with', () => {
    expect(resolveProfile(['--profile', '450', '--concurrency', '4']))
      .toMatchObject({ name: '450', batch: 450, concurrency: 4, rate: 450 });
  });

  it('refuses a profile that does not exist rather than silently using the default', () => {
    expect(() => resolveProfile(['--profile', 'turbo'])).toThrow(/unknown --profile turbo/);
  });

  it('refuses a rate above OpenAI\'s ceiling — the failure mode is 429s, not an error here', () => {
    expect(() => resolveProfile(['--rate', '900'])).toThrow(/500 req\/min/);
  });

  it('refuses nonsense knobs', () => {
    expect(() => resolveProfile(['--batch', '0'])).toThrow(/--batch/);
    expect(() => resolveProfile(['--concurrency', 'lots'])).toThrow(/--concurrency/);
  });
});

describe('the read path', () => {
  it('never asks videos.llm_summary what is outstanding', () => {
    // All seven deleted workers used `.is('llm_summary', null)` on `videos`. After the
    // null-out that matches all 1,118,401 rows and the worker re-bills the whole corpus.
    for (const sql of [needsSummaryBatchSql(), NEEDS_SUMMARY_COUNT_SQL]) {
      expect(sql).not.toMatch(/\bv\.llm_summary\s+is\s+null\b/i);
      expect(sql).toMatch(/coalesce\(vt\.llm_summary, v\.llm_summary\) is null/);
    }
  });

  it('takes the description from the side table', () => {
    expect(needsSummaryBatchSql()).toMatch(/coalesce\(vt\.description, v\.description\) as description/);
  });

  it('selects only the four fields the prompt needs, off a keyset cursor', () => {
    const sql = needsSummaryBatchSql();
    expect(sql).toMatch(/select v\.id, v\.title, v\.channel_name/);
    expect(sql).toMatch(/v\.id > \$1/);
    expect(sql).toMatch(/limit \$2/);
  });
});

describe('the prompt', () => {
  it('is byte-identical to the one the deleted workers sent', () => {
    expect(userPrompt({ id: 'x', title: 'T', channel_name: 'C', description: 'D' }))
      .toBe('Title: T\nChannel: C\nDescription: D');
  });

  it('keeps the exact fallback string, so a missing description reads the same as before', () => {
    expect(userPrompt({ id: 'x', title: 'T', channel_name: 'C', description: null }))
      .toBe('Title: T\nChannel: C\nDescription: No description available');
  });

  it('still forbids the meta-words the system prompt was written to forbid', () => {
    expect(SYSTEM_PROMPT).toContain('Never use the words "video", "tutorial", "channel"');
  });
});

describe('the rate limiter', () => {
  it('does not sleep until the window is full', async () => {
    let t = 0;
    const slept: number[] = [];
    const take = makeRateLimiter(3, () => t);
    for (let i = 0; i < 3; i++) await take(async (ms) => { slept.push(ms); });
    expect(slept).toEqual([]);
  });

  it('sleeps out the remainder of the window on the request that would exceed the rate', async () => {
    let t = 0;
    const slept: number[] = [];
    const take = makeRateLimiter(2, () => t);
    await take(async (ms) => { slept.push(ms); });
    t = 1_000;
    await take(async (ms) => { slept.push(ms); });
    t = 2_000;
    await take(async (ms) => { slept.push(ms); });
    expect(slept).toEqual([60_000 - 2_000 + 100]);
  });
});
