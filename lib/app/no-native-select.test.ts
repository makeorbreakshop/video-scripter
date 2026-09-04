/**
 * The style guide's one mechanical rule: no native <select> anywhere under app/app or
 * components/app. Every dropdown in the app is <Menu> / <Sort> from components/app/menu.tsx,
 * which a native option list cannot stand in for — it cannot hold a checkmark row, a tri-state
 * box, a colour dot or a destructive row, and it cannot be styled to match the other controls.
 *
 * Comments are stripped before the check, so prose about the rule does not trip it.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOTS = ['app/app', 'components/app'];
const EXTS = ['.ts', '.tsx'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

/** Drop /* … *​/ and // … so a comment mentioning the rule is not a violation of it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('no native select under app/', () => {
  const root = join(__dirname, '..', '..');

  it.each(ROOTS)('%s has no <select', (rel) => {
    const offenders = walk(join(root, rel))
      .filter((file) => /<select[\s>]/.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });
});
