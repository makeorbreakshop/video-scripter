// Bundle the extension sources into plain, module-free single files so the
// shipped extension has zero import statements (works in every Chromium).
// Usage: node scripts/build-extension.mjs
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const ext = path.join(dir, '../chrome-extension');

for (const entry of ['background', 'popup']) {
  await build({
    entryPoints: [path.join(ext, `src/${entry}.js`)],
    bundle: true,
    format: 'iife',
    outfile: path.join(ext, `${entry}.js`),
    logLevel: 'error',
  });
}
console.log('built background.js + popup.js (plain IIFE, no modules)');
