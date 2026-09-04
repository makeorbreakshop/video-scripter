/**
 * What a stranger can reach on the production domain.
 *
 * Of 73 page routes only /app, /admin, /dashboard and /quota-dashboard were behind Clerk, so
 * seventeen scratch routes were public — three competing designs of the title generator, two
 * of Thumbnail Battle, and a dozen /test-* pages, each with its own visual language and none
 * finished. A prospect who lands on one of those has seen a different, worse product.
 */
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { PROTECTED_ROUTES } from './route-policy';

const ROOT = join(__dirname, '..', '..');

/** Every route that renders a page, as a URL path. */
function routes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, url: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        // Route groups — (list) — do not appear in the URL.
        walk(full, entry.startsWith('(') ? url : `${url}/${entry}`);
      } else if (entry === 'page.tsx') {
        out.push(url || '/');
      }
    }
  };
  walk(join(ROOT, 'app'), '');
  return out.filter((r) => !r.startsWith('/api'));
}

/** The matcher patterns as regexes, the way createRouteMatcher reads them. */
function protectedMatchers(): RegExp[] {
  return PROTECTED_ROUTES
    .filter((p) => !p.startsWith('/api'))
    .map((p) => new RegExp(`^${p.replace(/\(\.\*\)$/, '.*')}$`));
}
const isProtected = (route: string) => protectedMatchers().some((re) => re.test(route));

const SCRATCH = /(^|\/)(test|.*-test|test-[a-z-]+|.*-tester|.*-demo|.*-debug|version\d+.*|.*-v2|.*-redesigned)$/;

describe('scratch routes are not public', () => {
  const scratch = routes().filter((r) => r.split('/').some((seg) => SCRATCH.test(seg)) || SCRATCH.test(r));

  it('finds the scratch routes that exist', () => {
    // If this drops to zero the pattern stopped matching, not the problem going away.
    expect(scratch.length).toBeGreaterThan(0);
  });

  it.each(scratch)('%s is behind auth', (route) => {
    expect(isProtected(route)).toBe(true);
  });
});

describe('the product surface stays public', () => {
  it.each(['/', '/privacy', '/terms', '/docs/api', '/thumbnail-battle'])('%s is reachable signed out', (route) => {
    expect(isProtected(route)).toBe(false);
  });
});
