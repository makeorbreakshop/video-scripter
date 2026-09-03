// Guard: every ChannelSmith query that decides whether a video is long-form must go through
// lib/scoring/longform.ts. A hand-rolled `is_short` filter silently re-admits 63-180s Shorts
// (ingest only flagged <=62s), which is how 75 Matt Wolfe clips became his "normal video" on
// 2026-09-03. This test scans the source tree and fails on any new offender.
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');

// Where ChannelSmith lives. Anything under these roots is held to the shared rule.
const SCANNED_ROOTS = ['lib', 'scripts', 'app/app', 'app/api/v1', 'server', 'workers'];

// Known exceptions, each with a reason. Remove an entry when its file is migrated.
const ALLOWLIST: Record<string, string> = {
  'lib/scoring/longform.ts': 'the definition itself',
  'lib/ingest/classify.ts': 'the ingest-side definition itself',
  'lib/unified-video-import.ts': 'legacy importer; writes the column, does not filter on it',
  'lib/hybrid-performance-cached.ts': 'legacy performance tool (supabase-js), pre-ChannelSmith',
  'lib/temporal-baseline-processor.ts': 'legacy temporal baseline (superseded by lib/scoring)',
  'scripts/recompute-baselines.ts': 'legacy temporal baseline recompute',
  'scripts/scan-shorts.ts': 'a Shorts detector: reads is_short to find unflagged videos',
  'scripts/verify-shorts.ts': 'a Shorts detector: reads is_short to find unflagged videos',
  'scripts/analysis/detection-latency.ts': 'one-off analysis script',
  'scripts/semantic/': 'semantic layer corpus selection; migrate with the semantic PRD (tracked)',
  'lib/semantic/': 'semantic layer corpus selection; migrate with the semantic PRD (tracked)',
  'app/api/v1/videos/[id]/route.ts': 'echoes the flag in the response; no filtering',
};

// A line carrying a PRIVATE duration rule. Every ingest path must classify through
// lib/ingest/classify.ts; a hand-rolled "<= 62s" copy is exactly the bug that let 63-180s
// Shorts into the corpus as long-form.
const DURATION_RULE_PATTERNS = [
  /<=\s*62\b/,
  /secs\s*<=\s*\d+/,
  /PT\(\?:\(\\d\+\)M\)\?\(\?:\(\\d\+\)S\)\?/,   // the ISO-8601 duration regex literal
];

// A line that FILTERS on the flag, as opposed to selecting or writing it.
const FILTER_PATTERNS = [
  /is_short\s*,?\s*false\s*\)\s*=\s*false/i,   // coalesce(x.is_short, false) = false
  /is_short\s*=\s*false/i,
  /is_short\s+is\s+(not\s+)?(true|null)/i,
  /\.eq\(\s*['"]is_short['"]/,                   // supabase-js
  /is_short\s*===?\s*true\)\s*return\s+false/,   // hand-rolled TS predicate
  /if\s*\(\s*v\.is_short\s*\)\s*return\s+false/,
  /'\^PT\(\(\[0-5\]/,                            // the old <=72s duration regex
];

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function allowed(rel: string): boolean {
  return Object.keys(ALLOWLIST).some((k) => (k.endsWith('/') ? rel.startsWith(k) : rel === k));
}

describe('long-form rule guard', () => {
  test('no ChannelSmith query filters Shorts by hand instead of longformSql / isLongform', () => {
    const offenders: string[] = [];
    for (const root of SCANNED_ROOTS) {
      for (const file of walk(path.join(ROOT, root))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        if (allowed(rel)) continue;
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (FILTER_PATTERNS.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no ingest path carries its own duration rule instead of lib/ingest/classify.ts', () => {
    const offenders: string[] = [];
    for (const root of SCANNED_ROOTS) {
      for (const file of walk(path.join(ROOT, root))) {
        const rel = path.relative(ROOT, file).split(path.sep).join('/');
        if (allowed(rel)) continue;
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (DURATION_RULE_PATTERNS.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every allowlisted path still exists (stale entries hide regressions)', () => {
    for (const k of Object.keys(ALLOWLIST)) {
      expect({ path: k, exists: fs.existsSync(path.join(ROOT, k)) }).toEqual({ path: k, exists: true });
    }
  });
});
