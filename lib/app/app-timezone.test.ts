// The app shows the READER's clock; the internal tools show Brandon's.
//
// The backend stays UTC and lib/admin/format.ts stays ET on purpose — admin pages and scripts
// have one reader and he is in Georgia. But the app is shipped to creators anywhere, and a
// creator in Berlin reading "Sep 4, 10:31 AM ET" has to do arithmetic before they can compare
// the chart to the day they remember. So nothing under components/app or app/app may name a
// zone: those surfaces format in the runtime's zone (lib/app/local-time.ts), which in the
// browser is the viewer's own, and the zone is named once — in the chart tooltip's header.
//
// This is a grep, deliberately: the rule is about what is IN the files, and a rule about source
// text is best asserted against source text.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
  };
  walk(join(ROOT, dir));
  return out;
}

describe('no hardcoded Eastern anywhere the app renders', () => {
  const files = [...sources('components/app'), ...sources('app/app')];

  it('finds the app source to check (a passing grep over nothing proves nothing)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(['components/app', 'app/app'])('%s names no time zone', (dir) => {
    const offenders = sources(dir).filter((f) => /America\/New_York|['"`]US\/Eastern['"`]/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  // The video page — chart, tooltip, tracking-began, header, packaging strip — is converted.
  // The feed rows and tiles still call the admin ET formatters; they are the next surface, and
  // this list is the ledger of what is left rather than a silence about it.
  const CONVERTED = [
    'components/app/video-chart.tsx',
    'components/app/video-chart-plot.tsx',
    'components/app/packaging-timeline.tsx',
    'app/app/videos/[id]/page.tsx',
    'app/app/inspiration/page.tsx',
  ];

  it.each(CONVERTED)('%s reaches for no admin ET formatter', (rel) => {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    expect(src).not.toMatch(/\betDateTime\b|\betDate\b|\betTimestamp\b|\betDayShort\b/);
  });

  it('still has the feed on the list of surfaces to convert', () => {
    const left = files
      .filter((f) => /\betDateTime\b|\betDate\b|\betTimestamp\b|\betDayShort\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1));
    // If this shrinks to nothing, delete the test. If it GROWS, a new surface went out on ET.
    expect(left.sort()).toEqual([
      'app/app/_components/feed-card.tsx',
      'app/app/_components/feed-row.tsx',
      'components/app/video-tile.tsx',
    ]);
  });

  it('leaves the admin surface on ET, which is the point of the split', () => {
    expect(readFileSync(join(ROOT, 'lib/admin/format.ts'), 'utf8')).toMatch(/America\/New_York/);
  });
});
