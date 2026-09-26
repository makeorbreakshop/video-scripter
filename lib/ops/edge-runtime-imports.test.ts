// An Edge-runtime route cannot bundle `pg` (it needs `fs`, `net`, `tls`). 2026-09-26: the
// description/metadata repoint made lib/vector-db-service.ts import the text accessor, which
// imports lib/admin/db.ts → pg; app/api/ai/chat (runtime = 'edge') imports vector-db-service, and
// the Vercel production build failed ("Can't resolve 'fs'" from pgpass). Local jest and tsc were
// green — nothing ran the Edge bundler. This walks every Edge route's local import graph instead.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const NODE_ONLY = [/^pg$/, /^pg\//, /^node:/, /^fs$/, /^net$/, /^tls$/, /^child_process$/];

function listRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listRoutes(p));
    else if (/^route\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  const stripped = base.replace(/\.(ts|tsx|js|mjs)$/, '');
  for (const c of [base, `${stripped}.ts`, `${stripped}.tsx`, `${stripped}.js`, path.join(stripped, 'index.ts')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** Every Node-only import reachable from `entry`, with the chain that reaches it. */
function nodeOnlyImports(entry: string): string[] {
  const seen = new Set<string>();
  const bad: string[] = [];
  const walk = (file: string, chain: string[]) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // Static and dynamic imports (webpack bundles both); `import type` is erased.
    for (const m of src.matchAll(/(?:^|\n)\s*import\s+(?!type\b)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const rel = path.relative(ROOT, file);
      if (NODE_ONLY.some((r) => r.test(spec))) { bad.push([...chain, rel, spec].join(' → ')); continue; }
      const next = resolveLocal(file, spec);
      if (next) walk(next, [...chain, rel]);
    }
  };
  walk(entry, []);
  return bad;
}

const edgeRoutes = listRoutes(path.join(ROOT, 'app'))
  .filter((f) => /export const runtime\s*=\s*['"]edge['"]/.test(fs.readFileSync(f, 'utf8')));

describe('Edge-runtime routes never reach a Node-only module', () => {
  it('finds the Edge routes (the scan is not vacuous)', () => {
    expect(edgeRoutes.length).toBeGreaterThan(0);
  });

  it.each(edgeRoutes.map((f) => [path.relative(ROOT, f), f]))('%s', (_rel, file) => {
    expect(nodeOnlyImports(file)).toEqual([]);
  });
});
