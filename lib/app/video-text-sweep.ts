// Finding the code that reads videos.description / metadata / llm_summary directly.
//
// The first version of this was three rg patterns — `llm_summary`, `\bv\.description\b`,
// `videos\.description` — and it was wrong in both directions.
//
// It over-matched: a third of the thirty files it listed were `worker_type: 'llm_summary'`
// string literals and the sibling columns llm_summary_generated_at / _model /
// _embedding_synced, which are flags and timestamps that stay on `videos` and can never be
// "fixed". Those six files could never have left the list, so the list could never reach zero.
//
// It under-matched, which is worse: it never looked for `metadata` at all. `metadata` is one of
// the three columns the null-out clears, and nineteen supabase-js call sites and four raw-SQL
// ones read it off `videos`. A ratchet that reaches zero while twenty-three unlisted readers
// are still live is not a safety device, it is a rubber stamp.
//
// So this is a scanner rather than a grep. It understands the two shapes this codebase uses to
// read a column off `videos`, and it understands the two idioms that are legitimate.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEDULED_SCRIPTS } from '../ops/scheduled-jobs';

export const MOVED_COLUMNS = ['description', 'metadata', 'llm_summary'] as const;
export type MovedColumn = (typeof MOVED_COLUMNS)[number];

/** Columns that merely start with a moved column's name and are NOT moving. */
const SIBLINGS = [
  'llm_summary_generated_at', 'llm_summary_model', 'llm_summary_embedding_synced',
  'channel_metadata', 'metadata_updated_at',
];

export const SCANNED_GLOBS = ['app/**', 'lib/**', 'components/**', 'workers/**', 'contexts/**', 'hooks/**'];

/** The accessor and the migration modules are allowed to name these columns on `videos`. */
export const ALLOWED = [
  'lib/app/video-text.ts',
  'lib/app/video-text-move.ts',
  'lib/app/video-text-sweep.ts',
  'lib/app/video-text-access.test.ts',
  'lib/app/video-text-move.test.ts',
  'lib/app/video-text-sweep.test.ts',
  'lib/app/video-text.test.ts',
];

/**
 * Blank out everything that is a legitimate mention, so what is left is a real direct read.
 *
 * 1. `coalesce(vt.x, v.x)` — the accessor's own transitional idiom: the side copy when the
 *    mover has reached the row, the original otherwise. Correct before AND after the null-out,
 *    because after it the original is NULL and the side copy is the answer. A file may only use
 *    it if it also imports the accessor, which is checked separately.
 * 2. `vt.x` — reading the side table. That is the whole point.
 * 3. The sibling columns above.
 * 4. Line and block comments, so prose about the migration does not register as a reader.
 * 5. String literals used as worker_type / job type values ('llm_summary', and the
 *    'llm_summary_vectorization' worker name).
 */
export function maskLegitimate(src: string): string {
  // Newlines survive blanking, or every line number after a block comment is wrong.
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + blank(m.slice(p1.length)))
    .replace(/coalesce\(\s*vt\.\w+\s*,\s*v\.\w+\s*\)/g, blank)
    .replace(/\bvt\.\w+/g, blank)
    .replace(/'llm_summary_vectorization'|'llm_summary'|"llm_summary"/g, blank)
    .replace(new RegExp(`\\b(${SIBLINGS.join('|')})\\b`, 'g'), blank);
}

/**
 * Every string literal in the file that is actually SQL: a template literal or quoted string
 * containing a SQL verb. Raw-SQL reads are only looked for inside these.
 *
 * WHY, rather than grepping for `v.description` across the whole file. `v.description` is also
 * how JavaScript reads a property off a row object — and after the refactor that object is
 * hydrated from video_text, so `description: v.description ?? undefined` is correct code that a
 * bare grep flags as a direct read. Eleven of the files this scanner first reported were that
 * exact shape. SQL lives in strings; that is the distinction that holds.
 */
export function sqlStrings(src: string): string[] {
  const out: string[] = [];
  const re = /`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;
  for (const m of src.matchAll(re)) {
    const body = m[0].slice(1, -1);
    if (/\b(select|insert\s+into|update|delete\s+from)\b/i.test(body)) out.push(body);
  }
  return out;
}

/** A qualified read in raw SQL: `v.description`, `videos.metadata`, `v.llm_summary`. */
function sqlHits(masked: string, col: MovedColumn): boolean {
  const qualified = new RegExp(`\\b(v|videos)\\.${col}\\b`);
  for (const sql of sqlStrings(masked)) {
    if (qualified.test(sql)) return true;
    // An unqualified column in a statement that names `videos` and nothing else.
    //
    // Two exclusions, both learned from false positives. A template literal carrying an
    // unresolved `${...}` may be splicing in a join (VIDEO_TEXT_JOIN is exactly that), so the
    // "no other table" premise cannot be checked and the rule is not applied. And `as
    // description` is an output alias, not a read — it is how the accessor names the column it
    // just coalesced.
    if (sql.includes('${')) continue;
    const stripped = sql.replace(new RegExp(`\\bas\\s+${col}\\b`, 'gi'), '');
    if (/\b(from|into|update)\s+videos\b/i.test(stripped) && !/\bjoin\b/i.test(stripped)
        && new RegExp(`\\b${col}\\b`).test(stripped)) return true;
  }
  return false;
}

const FILTERS = ['select', 'is', 'not', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
                 'filter', 'in', 'order', 'contains', 'update', 'insert', 'upsert'];

/**
 * A supabase-js read or write: `.from('videos')` followed, within the SAME STATEMENT, by the
 * column named in a position that actually reaches the database.
 *
 * Two things had to be tightened here. The chain is bounded by the next `;`, not by a fixed
 * character window — an 800-character window ran past the end of the statement and swallowed
 * whatever happened to follow, which is how `videoMetadata.likeCount` three lines later was
 * reported as a read of `videos.metadata`. And the column only counts inside a `.select()`
 * string or as the first argument of a filter method, so a local variable that merely contains
 * the word is not a hit.
 */
function supabaseHits(masked: string, col: MovedColumn): boolean {
  const re = /\.from\(\s*['"]videos['"]\s*\)([^;]{0,1200})/g;
  const inSelect = new RegExp(`\\.select\\(\\s*['\`"][^'\`"]*\\b${col}\\b`);
  const inFilter = new RegExp(`\\.(${FILTERS.join('|')})\\(\\s*['"]${col}\\b`);
  const inPayload = new RegExp(`\\b${col}\\s*:`);
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    const chain = m[1];
    if (inSelect.test(chain) || inFilter.test(chain) || inPayload.test(chain)) return true;
  }
  return false;
}

export interface Hit { file: string; columns: MovedColumn[] }

/** Every file under SCANNED_GLOBS that reads one of the moved columns off `videos`. */
export function directReaders(root: string, columns: readonly MovedColumn[] = MOVED_COLUMNS): Hit[] {
  const res = spawnSync('rg', [
    '-l', '--no-messages', ...SCANNED_GLOBS.flatMap((g) => ['-g', g]),
    '-e', columns.join('|'), '.',
  ], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0 && res.status !== 1) throw new Error(`rg exited ${res.status}: ${res.stderr}`);

  // Plus every script a LaunchAgent runs (lib/ops/scheduled-jobs.ts). The globs above never
  // covered scripts/, so scripts/rss-poll.ts — reading videos.description every five minutes —
  // was invisible to this gate until 2026-09-26.
  const mentions = new RegExp(`\\b(${columns.join('|')})\\b`);
  const scheduled = SCHEDULED_SCRIPTS.filter((f) => {
    try { return mentions.test(fs.readFileSync(path.join(root, f), 'utf8')); } catch { return false; }
  });
  const files = [...new Set([...((res.stdout ?? '').trim() ? res.stdout.trim().split('\n') : []), ...scheduled])]
    .map((f) => f.replace(/^\.\//, ''))
    // Tests are not runtime readers: they quote this SQL on purpose, to pin it.
    .filter((f) => !ALLOWED.includes(f) && !/\.test\.tsx?$/.test(f))
    .sort();

  const hits: Hit[] = [];
  for (const f of files) {
    let src: string;
    try { src = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    const masked = maskLegitimate(src);
    const cols = columns.filter((c) => sqlHits(masked, c) || supabaseHits(masked, c));
    if (cols.length) hits.push({ file: f, columns: cols });
  }
  return hits;
}
