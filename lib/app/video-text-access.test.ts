// The precondition for a destructive migration, one column at a time.
//
// scripts/null-video-text.ts sets videos.description / metadata / llm_summary to NULL. The
// moment it runs, every call site that still reads those columns from `videos` — rather than
// through lib/app/video-text.ts — starts silently returning nothing. Not an error: a filter
// that matches no rows, a prompt with an empty description, a count that says the whole corpus
// is pending. So the null-out cannot run for a column until that column has no direct readers,
// and this file is what decides that.
//
// WHAT CHANGED ON 2026-09-14, AND WHY IT MATTERS. The first version of this ratchet was three
// rg patterns and a list of thirty files, and it was wrong in both directions.
//
//   It over-matched. Six of the thirty were never readers at all: `worker_type: 'llm_summary'`
//   string literals and the sibling columns llm_summary_generated_at / _model /
//   _embedding_synced, which are flags and timestamps that stay on `videos`. Those six could
//   never be "fixed", so the list could never reach zero, so the gate could never open.
//
//   It under-matched, which is far worse. It never looked for `metadata` at all — one of the
//   three columns it exists to protect. Eighteen live call sites read videos.metadata,
//   including the video detail page, the RSS ingest path and four channel-discovery services.
//   The original list would have reached zero with all eighteen still live.
//
// It is a scanner now (lib/app/video-text-sweep.ts), and the verdict is per column, because
// the three columns did not become safe together and waiting for the slowest one is a decision
// to reclaim nothing.
import path from 'node:path';
import { directReaders, MOVED_COLUMNS, type MovedColumn } from './video-text-sweep';
import { CLEARED_COLUMNS } from './video-text-move';

const ROOT = path.resolve(__dirname, '..', '..');

const readersOf = (col: MovedColumn) =>
  directReaders(ROOT, [col]).map((h) => h.file).sort();

/**
 * CLEARED: columns with no direct readers left. The null-out may clear these, and the ingest
 * writers stop writing them to `videos`. The list itself lives in lib/app/video-text-move.ts
 * (CLEARED_COLUMNS) so the runtime and this ratchet can never disagree about it.
 *
 * llm_summary got here on 2026-09-14: seven workers collapsed into one, five services and
 * fourteen routes repointed at the accessor.
 */
const CLEARED: MovedColumn[] = [...CLEARED_COLUMNS];

/**
 * BLOCKED: columns that still have direct readers, with the exact list. Each entry has to be
 * repointed at lib/app/video-text.ts before its column can be cleared. Listed rather than
 * counted so the diff shows which one was fixed, and so a NEW one fails this test loudly.
 */
const BLOCKED: Record<string, string[]> = {
  description: [
    // `.not('description','ilike','%#shorts%')` — a FILTER. After the null-out it matches no
    // rows at all, so both of these searches return empty and nothing reports an error.
    'app/api/concept-search/route.ts',
    'app/api/concept-search-multi/route.ts',
    'lib/pinecone-service.ts',
    // selects the description and renders it as the bundle summary
    'app/api/tools/get-video-bundle/route.ts',
    'app/api/classification/batch-with-insights/route.ts',
    // WRITERS: these insert or upsert description back into `videos`. Until they are repointed,
    // clearing the column reclaims space that the next import puts straight back.
    'app/api/youtube/backfill-rss/route.ts',
    'app/api/youtube/refresh-channel-analytics/route.ts',
    'app/api/youtube/sync-channel/route.ts',
    'lib/vector-db-service.ts',
  ],
  metadata: [
    // None of these were ever on the original list, because it never grepped for `metadata`.
    'app/api/videos/search/route.ts',
    'app/api/youtube/backfill-rss/route.ts',
    'app/api/youtube/check-existing-channels/route.ts',
    'app/api/youtube/competitor-channels/route.ts',
    'app/api/youtube/discovery/collaborations/route.ts',
    'app/api/youtube/discovery/search/route.ts',
    'app/api/youtube/expand-research-channel/route.ts',
    'app/api/youtube/fix-channel-ids/route.ts',
    'app/api/youtube/import-rss/route.ts',
    'app/api/youtube/refresh-competitor-channel/route.ts',
    'lib/admin/queries.ts',
    'lib/app/video-page.ts',          // the video detail page's own server query
    'lib/collaboration-mining-discovery.ts',
    'lib/multi-channel-shelves-discovery.ts',
    'lib/playlist-creator-discovery.ts',
    'lib/vector-db-service.ts',
    'workers/daily-topic-classifier.js',
  ],
};

describe.each(CLEARED)('%s — cleared for the null-out', (col) => {
  it('has no direct readers left, which is what lets the null-out clear it', () => {
    expect(readersOf(col)).toEqual([]);
  });
});

describe.each(Object.keys(BLOCKED))('%s — still blocked', (col) => {
  it('has not grown — a new direct reader must use lib/app/video-text.ts instead', () => {
    const added = readersOf(col as MovedColumn).filter((f) => !BLOCKED[col].includes(f));
    expect(added).toEqual([]);
  });

  it('only ever shrinks — remove a file from BLOCKED when you repoint it', () => {
    const found = readersOf(col as MovedColumn);
    expect(BLOCKED[col].filter((f) => !found.includes(f))).toEqual([]);
  });

  it('BLOCKS the null-out for this column while any reader remains', () => {
    const remaining = readersOf(col as MovedColumn).length;
    expect(remaining).toBe(BLOCKED[col].length);
    expect(CLEARED).not.toContain(col);
  });
});

describe('the reverse check', () => {
  it('accounts for every moved column: each is either cleared or explicitly blocked', () => {
    // A column that is in neither list has no gate at all, which is the failure mode that let
    // `metadata` go eighteen readers deep without anyone noticing.
    for (const c of MOVED_COLUMNS) {
      expect(CLEARED.includes(c) || c in BLOCKED).toBe(true);
    }
  });

  it('names no file twice within a column', () => {
    for (const [col, files] of Object.entries(BLOCKED)) {
      expect(new Set(files).size).toBe(files.length);
    }
  });

  it('leaves the accessor as the only place a cleared column is named against `videos`', () => {
    // The whole point, stated as the assertion it is: for a column that has been cleared, the
    // scanner — which understands the coalesce idiom, the side table and the sibling columns —
    // finds nothing outside lib/app/video-text.ts and its migration modules.
    for (const col of CLEARED) expect(readersOf(col)).toHaveLength(0);
  });
});
