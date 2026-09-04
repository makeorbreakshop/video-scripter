// Guard: the title-observation stamp lives in `video_title_watch`, never on `videos`.
//
// Stamping videos.title_observed_at was measured on 2026-09-04 at 22 % of ALL execution on the
// instance — 181 s in a clean 9-minute window, 30.2 s mean, 701 MB read — and was sampled at 116 s
// deep in IO/DataFileRead on a single rss-poll tick. `videos` has a 1,819-byte average row, 794 MB
// of TOAST and 45 indexes and is only 18.2 % HOT, so a 50-byte fact that changes every five
// minutes was rewriting a 1.8 KB tuple and up to 45 index entries per stamp.
//
// The column is deliberately still THERE (it is the rollback, sql/2026-09-04-video-title-watch.sql),
// which is exactly why this test exists: nothing stops a future writer reaching for it again.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const SCANNED_ROOTS = ['lib', 'scripts', 'app'];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.next') walk(p, out); }
    else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('title-observation stamp guard', () => {
  // A WRITE: `update videos ... title_observed_at = ...`, however many lines it spans.
  const WRITE_TO_VIDEOS = /update\s+videos\b[\s\S]{0,400}?\btitle_observed_at\s*=/i;
  // A READ off the wide table: the column named on the same line as `videos` in a SQL string.
  const READ_FROM_VIDEOS = [
    /\bfrom\s+videos\b[^\n]*\btitle_observed_at\b/i,
    /\btitle_observed_at\b[^\n]*\bfrom\s+videos\b/i,
    /\bv\.title_observed_at\b(?=[^\n]*\b(select|from|where|set)\b)/i,
  ];

  test('no SQL writes videos.title_observed_at', () => {
    const offenders: string[] = [];
    for (const root of SCANNED_ROOTS) {
      for (const file of walk(path.join(ROOT, root))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        const text = fs.readFileSync(file, 'utf8');
        if (WRITE_TO_VIDEOS.test(text)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no SQL reads the frozen videos.title_observed_at column', () => {
    const offenders: string[] = [];
    for (const root of SCANNED_ROOTS) {
      for (const file of walk(path.join(ROOT, root))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (READ_FROM_VIDEOS.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  test('the migration that created the side table is present', () => {
    expect(fs.existsSync(path.join(ROOT, 'sql/2026-09-04-video-title-watch.sql'))).toBe(true);
  });
});
