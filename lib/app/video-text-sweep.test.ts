// The scanner itself. A safety device that is not tested is a decoration.
import { maskLegitimate, directReaders, sqlStrings, MOVED_COLUMNS } from './video-text-sweep';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');

describe('what counts as a legitimate mention', () => {
  const masked = (s: string) => maskLegitimate(s);

  it('does not count the accessor\'s coalesce idiom as a direct read', () => {
    expect(masked('coalesce(vt.description, v.description) as description'))
      .not.toMatch(/v\.description/);
  });

  it('does not count reading the side table', () => {
    expect(masked('select vt.llm_summary from video_text vt')).not.toMatch(/llm_summary/);
  });

  it('does not count the sibling bookkeeping columns, which are not moving', () => {
    for (const s of ['llm_summary_generated_at', 'llm_summary_model', 'llm_summary_embedding_synced']) {
      expect(masked(`v.${s}`)).not.toMatch(/llm_summary/);
    }
  });

  it('does not count a worker_type string literal', () => {
    expect(masked(`.eq('worker_type', 'llm_summary')`)).not.toMatch(/llm_summary/);
  });

  it('does not count prose in a comment', () => {
    expect(masked('// videos.description is 1,038 bytes a row')).not.toMatch(/description/);
    expect(masked('/* v.metadata is 742 */')).not.toMatch(/metadata/);
  });

  it('DOES still count a real qualified read', () => {
    expect(masked('select v.description from videos v')).toMatch(/v\.description/);
    expect(masked('select videos.metadata from videos')).toMatch(/videos\.metadata/);
  });

  it('keeps line numbers intact when it blanks a block comment', () => {
    // The first version replaced the whole comment with spaces, newlines included, so every
    // line number it reported after one was wrong — which is how a hit on line 1,843 was
    // printed as line 75.
    const src = '/* a\n b\n c */\nselect v.description from videos v';
    expect(masked(src).split('\n').length).toBe(src.split('\n').length);
  });

  it('DOES still count a bare column inside a .from(\'videos\') chain', () => {
    const src = `.from('videos').select('id, title, description').eq('x', 1)`;
    expect(masked(src)).toMatch(/description/);
  });
});

describe('the scanner over this repository', () => {
  it('names every column it found, so a report says what is left and where', () => {
    const hits = directReaders(ROOT);
    for (const h of hits) {
      expect(h.columns.length).toBeGreaterThan(0);
      for (const c of h.columns) expect(MOVED_COLUMNS).toContain(c);
    }
  });

  it('never reports the accessor itself', () => {
    expect(directReaders(ROOT).map((h) => h.file)).not.toContain('lib/app/video-text.ts');
  });
});


describe('telling SQL from JavaScript', () => {
  it('only treats a string containing a SQL verb as SQL', () => {
    expect(sqlStrings('const a = `select v.description from videos v`')).toHaveLength(1);
    expect(sqlStrings("const msg = 'no description available'")).toHaveLength(0);
  });

  it('does not call a property read on a hydrated row a direct read', () => {
    // `description: v.description ?? undefined` where v came out of videoTextFor() is correct
    // code. Eleven files were first reported on exactly this shape.
    const src = 'const rows = hydrated.map((v) => ({ description: v.description ?? undefined }));';
    expect(directReadersIn(src, 'description')).toBe(false);
  });

  it('does still call the same text inside a query string a direct read', () => {
    const src = 'await q(`select v.id, v.description from videos v where v.id = $1`);';
    expect(directReadersIn(src, 'description')).toBe(true);
  });
});

/** The scanner's per-file decision, exercised on a source snippet. */
function directReadersIn(src: string, col: any): boolean {
  const fs = require('node:fs');
  const os = require('node:os');
  const p = require('node:path');
  const dir = fs.mkdtempSync(p.join(os.tmpdir(), 'sweep-'));
  fs.mkdirSync(p.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(p.join(dir, 'lib', 'probe.ts'), src);
  const hits = directReaders(dir, [col]);
  return hits.some((h) => h.file === 'lib/probe.ts');
}
