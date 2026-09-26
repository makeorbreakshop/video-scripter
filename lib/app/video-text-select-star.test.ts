// `select('*')` on `videos` is invisible to the reader sweep (lib/app/video-text-sweep.ts): the
// columns are never named, and the rows travel on in variables. Once the text columns are cleared
// those rows carry NULL text, so every such file was audited by hand on 2026-09-26 and is listed
// here with what it does with the text. A NEW select('*') on videos fails this test until someone
// looks at it: hydrate through lib/app/video-text.ts, or record why it needs no text.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

type Disposition = 'no-text' | 'hydrates' | 'count-only';
const AUDITED: Record<string, Disposition> = {
  'app/actions/skyscraper-analysis.ts': 'no-text',
  'app/api/analyze-pattern-improved/route.ts': 'no-text',
  'app/api/analyze-pattern-thinking-test/route.ts': 'no-text',
  'app/api/categorization/stats/route.ts': 'count-only',
  'app/api/classification/auto-run/route.ts': 'hydrates',
  'app/api/classification/count-low-confidence/route.ts': 'count-only',
  'app/api/classification/reclassify-low-confidence/route.ts': 'count-only',
  'app/api/classification/status/route.ts': 'count-only',
  'app/api/debug-update-all/route.ts': 'no-text',
  'app/api/discovery/videos/route.ts': 'hydrates',
  'app/api/idea-radar/route.ts': 'no-text',
  'app/api/planning/analyze-patterns/route.ts': 'no-text',
  'app/api/planning/get-outliers/route.ts': 'no-text',
  'app/api/planning/search-topic/route.ts': 'no-text',
  'app/api/search/unified/route.ts': 'hydrates',
  'app/api/skyscraper/analyze-stream/route.ts': 'no-text',
  'app/api/skyscraper/analyze/route.ts': 'no-text',
  'app/api/thumbnail-battle/get-matchup/route.ts': 'no-text',
  'app/api/thumbnail-battle/get-similar-matchup/route.ts': 'no-text',
  'app/api/tools/detect-novelty-factors/route.ts': 'no-text',
  'app/api/tools/find-competitive-successes/route.ts': 'no-text',
  'app/api/tools/find-content-gaps/route.ts': 'no-text',
  'app/api/tools/get-comprehensive-video-analysis/route.ts': 'no-text',
  'app/api/tools/suggest-pattern-hypotheses/route.ts': 'no-text',
  'app/api/vector/bulk-process/route.ts': 'no-text',
  'app/api/vector/process-video/route.ts': 'no-text',
  'app/api/vector/videos/route.ts': 'no-text',
  'app/api/view-tracking/debug/route.ts': 'no-text',
  'app/api/view-tracking/update-all/route.ts': 'no-text',
  'app/api/youtube/analytics/video-count/route.ts': 'count-only',
  'app/api/youtube/discovery/cluster-stats/route.ts': 'no-text',
  'app/api/youtube/discovery/debug-discovery/route.ts': 'no-text',
  'app/api/youtube/patterns/test-discovery/route.ts': 'no-text',
  'lib/pattern-lifecycle-tracker.ts': 'no-text',
  'lib/pinecone-summary-service.ts': 'hydrates',
  'lib/skyscraper-db-service.ts': 'no-text',
  'lib/supabase-pinecone-sync.ts': 'no-text',
  'lib/vector-db-service.ts': 'hydrates',
  'lib/view-tracking-service.ts': 'no-text',
};

function selectStarFiles(): string[] {
  const r = spawnSync('rg', ['-l', '-U', '--multiline', '-g', '!*.test.ts',
    `from\\(\\s*['"]videos['"]\\s*\\)[^;]{0,300}\\.select\\(\\s*['"]\\*['"]`, 'app', 'lib', 'workers', 'components'],
    { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1) throw new Error(r.stderr);
  return (r.stdout || '').trim().split('\n').filter(Boolean).sort();
}

describe("select('*') on videos", () => {
  const found = selectStarFiles();

  it('every file doing it has been audited', () => {
    expect(found.filter((f) => !(f in AUDITED))).toEqual([]);
  });

  it('a file marked "hydrates" really goes through the accessor', () => {
    for (const [f, d] of Object.entries(AUDITED)) {
      if (d !== 'hydrates' || !found.includes(f)) continue;
      expect([f, /videoTextFor|hydrateVideoTextFields|video_text/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))])
        .toEqual([f, true]);
    }
  });
});
