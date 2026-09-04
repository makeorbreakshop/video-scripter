import fs from 'node:fs';
import path from 'node:path';

describe('scoring prior lookup', () => {
  it('matches the existing descending nulls-last channel index while retaining newest-prior semantics', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts/score-videos.ts'), 'utf8');
    const query = source.slice(source.indexOf('async function priorsFor'), source.indexOf('/** The est30 side'));

    expect(query).toContain('p.published_at < v.published_at');
    expect(query).toContain('order by p.published_at desc nulls last');
    expect(query).toContain(`limit \${PRIOR_WINDOW}`);
  });
});
