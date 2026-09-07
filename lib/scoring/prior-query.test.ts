import fs from 'node:fs';
import path from 'node:path';

describe('scoring prior lookup', () => {
  it('matches the existing descending nulls-last channel index while retaining newest-prior semantics', () => {
    // The query moved out of scripts/score-videos.ts into lib so the video page's typical line
    // can be built from the SAME prior set the score divides by (lib/app/typical-curve.ts).
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/scoring/prior-load.ts'), 'utf8');
    const query = source.slice(source.indexOf('export async function loadPriorRefs'), source.indexOf('export async function loadRecords'));

    expect(query).toContain('p.published_at < v.published_at');
    expect(query).toContain('order by p.published_at desc nulls last');
    expect(query).toContain(`limit \${PRIOR_WINDOW}`);
    expect(query).toContain('PRIOR_STALE_DAYS');
  });

  it('is the only place the scorer gets its priors from', () => {
    const scorer = fs.readFileSync(path.join(process.cwd(), 'scripts/score-videos.ts'), 'utf8');
    expect(scorer).toContain("from '../lib/scoring/prior-load'");
    expect(scorer).not.toContain('order by p.published_at desc nulls last');
  });
});
