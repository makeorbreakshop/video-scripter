// A ratchet on the direct readers of videos.description / metadata / llm_summary.
//
// scripts/null-video-text.ts sets those three columns to NULL. The moment it runs, every
// call site that still reads them from `videos` — rather than through lib/app/video-text.ts —
// starts silently returning null. So the null-out CANNOT be scheduled until this list is empty,
// and this test exists to make sure the list only ever shrinks.
//
// It is not a style rule. It is the precondition for a destructive migration.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Live application code that still reads the `videos` text columns directly, as of 2026-09-14.
 *
 * Each one has to be repointed at lib/app/video-text.ts (videoTextFor / VIDEO_TEXT_JOIN) before
 * the null-out can run. They are listed rather than counted so that the diff shows exactly which
 * one was fixed — and so that adding a NEW one fails this test instead of passing quietly.
 *
 * Excluded from the sweep, deliberately: scripts/ and tests/ one-shot checks, sql/ and
 * supabase/migrations/ (they define the columns), docs/ and archive/.
 */
const KNOWN_DIRECT_READERS = [
  'app/api/adapt-idea/route.ts',
  'app/api/analyze-channel-style/route.ts',
  'app/api/analyze-pattern-enhanced/route.ts',
  'app/api/analyze-pattern/route.ts',
  'app/api/classification/auto-run/route.ts',
  'app/api/classification/llm-batch/route.ts',
  'app/api/extract-frames/route.ts',
  'app/api/idea-radar/route.ts',
  'app/api/vector/search/description/route.ts',
  'app/api/workers/llm-summary/control/route.ts',
  'app/api/workers/llm-summary/progress/route.ts',
  'app/api/workers/llm-summary/run/route.ts',
  'app/api/workers/vectorization/control/route.ts',
  'app/api/workers/vectorization/progress/route.ts',
  'app/dashboard/age-adjusted-debug/page.tsx',
  'app/dashboard/youtube/worker/page.tsx',
  'app/videos/[id]/page.tsx',
  'components/video-detail-modal.tsx',
  'lib/llm-format-classification-service.ts',
  'lib/llm-summary-batch-processor.ts',
  'lib/pinecone-summary-service.ts',
  'lib/unified-import-summary-integration.ts',
  'lib/unified-video-import.ts',
  'workers/llm-summary-vectorization-worker.ts',
];

/** The accessor itself, and the two migration scripts, are allowed to name the columns. */
const ALLOWED = [
  'lib/app/video-text.ts',
  'lib/app/video-text-move.ts',
  'lib/app/video-text-access.test.ts',
  'lib/app/video-text-move.test.ts',
];

function directReaders(): string[] {
  const res = spawnSync('rg', [
    '-l', '--no-messages',
    '-g', 'app/**', '-g', 'lib/**', '-g', 'components/**',
    '-g', 'workers/**', '-g', 'contexts/**', '-g', 'hooks/**',
    '-e', 'llm_summary',
    '-e', '\\bv\\.description\\b',
    '-e', 'videos\\.description',
    '.',
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  // exit 1 is rg's "no matches", which is the state this test is waiting for.
  if (res.error) throw res.error;
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`rg exited ${res.status}: ${res.stderr}`);
  }
  const out = (res.stdout ?? '').trim();
  return (out ? out.split('\n') : [])
    .map((f) => f.replace(/^\.\//, ''))
    .filter((f) => !ALLOWED.includes(f))
    .sort();
}

describe('direct readers of the videos text columns', () => {
  it('has not grown — a new direct reader must use lib/app/video-text.ts instead', () => {
    const found = directReaders();
    const added = found.filter((f) => !KNOWN_DIRECT_READERS.includes(f));
    expect(added).toEqual([]);
  });

  it('only ever shrinks — remove a file from KNOWN_DIRECT_READERS when you repoint it', () => {
    const found = directReaders();
    const stale = KNOWN_DIRECT_READERS.filter((f) => !found.includes(f));
    expect(stale).toEqual([]);
  });

  it('BLOCKS the null-out while any direct reader remains', () => {
    // This is the assertion that matters. When it finally reads `toBe(0)` and passes with an
    // empty list, scripts/null-video-text.ts is safe to schedule — and not one night before.
    const remaining = directReaders().length;
    expect(remaining).toBe(KNOWN_DIRECT_READERS.length);
    if (remaining > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `null-out BLOCKED: ${remaining} call site(s) still read videos.description / metadata / ` +
        `llm_summary directly. Repoint them at lib/app/video-text.ts first.`);
    }
  });
});
