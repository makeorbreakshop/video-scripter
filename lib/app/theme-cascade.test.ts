/**
 * The cascade rules for app/app/theme.css.
 *
 * theme.css is written as a component system: one class per control, each declaring its own
 * colour and type. Two element resets near the top —
 *
 *     .cs-app a      { color: inherit; … }
 *     .cs-app button { font: inherit; color: inherit; }
 *
 * — are *two*-part selectors, so they score (0,1,1) and outrank every single-class component
 * rule in the same file, whatever the source order. The result was silent: the wordmark took
 * --cs-ink instead of --cs-accent-on and rendered at 3.4:1, every .cs-btn rendered 14px/400
 * instead of 13px/550, and .cs-chip came out 11px as an <a> and 14px as a <button>.
 *
 * The fix is :where(), which contributes zero specificity — the reset still beats the UA
 * default and now loses to any component class. These tests keep it that way.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const THEME = readFileSync(join(ROOT, 'app/app/theme.css'), 'utf8');

/** Drop comments so prose about a rule is not read as the rule. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

const CSS = stripComments(THEME);

/** Every `selector { body }` pair in the file, selectors split on commas. */
function rules(): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  for (const [, sel, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const one of sel.split(',')) {
      const selector = one.trim();
      if (selector && !selector.startsWith('@')) out.push({ selector, body });
    }
  }
  return out;
}

describe('theme.css cascade', () => {
  // ------------------------------------------------------------------ resets
  it('scopes every blanket element reset in :where(), so components win', () => {
    // `.cs-app a`, `.cs-chead span` — a class plus a bare tag scores (0,1,1) and beats every
    // single-class component rule in the file whatever the source order. `.cs-app *` is fine
    // (the universal adds nothing) and `:where(a)` is the fix. This bit twice: the wordmark's
    // colour under `.cs-app a`, and the channel table's sparkline lane, whose `flex: 1 1 120px`
    // lost to `.cs-chead span { flex: none }` in the header but not in the rows — so the column
    // heads stopped lining up with their own data.
    const unscoped = rules()
      .map((r) => r.selector)
      .filter((s) => /^\.[a-zA-Z0-9_-]+(\[[^\]]*\])?(:[a-zA-Z-]+(\([^)]*\))?)*\s+[a-z]+[0-9]?\b/.test(s));
    expect(unscoped).toEqual([]);
  });

  it('keeps the resets themselves — a bare <button> must not inherit the UA font', () => {
    // The fix is about specificity, not about deleting the reset: without it every button
    // falls back to the browser's 13.33px Arial.
    expect(CSS).toMatch(/\.cs-app\s+:where\(a\)/);
    expect(CSS).toMatch(/\.cs-app\s+:where\(button\)/);
  });

  // ------------------------------------------------------------- dangling hooks
  it('has no class hook that is referenced in JSX but never styled', () => {
    const EXTS = ['.tsx'];
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (EXTS.some((e) => entry.endsWith(e))) out.push(full);
      }
      return out;
    };
    const files = [...walk(join(ROOT, 'app/app')), ...walk(join(ROOT, 'components/app'))];

    const used = new Set<string>();
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
        for (const part of [m[1], m[2], m[3]]) {
          if (!part) continue;
          for (const cls of part.matchAll(/\b(?:cs|tr)-[a-zA-Z0-9_-]+/g)) used.add(cls[0]);
        }
      }
    }
    const dangling = [...used].filter((c) => !new RegExp(`\\.${c}\\b`).test(CSS)).sort();
    expect(dangling).toEqual([]);
  });

  it('gives .cs-fcard-sub its own rule — the feed card\'s secondary tier', () => {
    // It was only ever styled as `.cs-fcard-stats .cs-fcard-sub`, so the same class rendered
    // at --cs-ink/14px in the byline and the change rows: no hierarchy below the title.
    const own = rules().find((r) => r.selector === '.cs-fcard-sub');
    expect(own).toBeDefined();
    expect(own!.body).toMatch(/color:\s*var\(--cs-muted\)/);
  });
});

// --------------------------------------------------------------------- contrast

/** WCAG 2.1 relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** The token values declared in one theme block. */
function tokens(blockSelector: string): Record<string, string> {
  const start = CSS.indexOf(blockSelector);
  if (start < 0) throw new Error(`no ${blockSelector} block in theme.css`);
  const body = CSS.slice(CSS.indexOf('{', start) + 1, CSS.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--cs-[a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g)) {
    out[name] = value;
  }
  return out;
}

describe('theme.css contrast', () => {
  const THEMES: [string, string][] = [
    ['light', ':root {'],
    ['dark', ':root[data-cs-theme="dark"] {'],
  ];

  describe.each(THEMES)('%s', (_name, selector) => {
    const t = tokens(selector);

    // The header comment in theme.css states these ratios. They are now assertions.
    it.each([
      ['ink on ground', '--cs-ink', '--cs-ground', 4.5],
      ['muted on ground', '--cs-muted', '--cs-ground', 4.5],
      ['accent on ground', '--cs-accent', '--cs-ground', 4.5],
      ['good on ground', '--cs-good', '--cs-ground', 4.5],
      ['warn on ground', '--cs-warn', '--cs-ground', 4.5],
      ['bad on ground', '--cs-bad', '--cs-ground', 4.5],
      ['ink on surface', '--cs-ink', '--cs-surface', 4.5],
      ['muted on surface', '--cs-muted', '--cs-surface', 4.5],
    ])('%s clears AA', (_label, fg, bg, min) => {
      expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
    });

    it('--cs-accent-on clears AA on an accent fill', () => {
      // This is the wordmark plate, the primary button and the "on" coin. The theme header
      // claims >= 7:1; AA is the floor that must never slip.
      expect(contrast(t['--cs-accent-on'], t['--cs-accent'])).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('the wordmark takes --cs-accent-on, not whatever it inherits', () => {
    const marquee = rules().find((r) => r.selector === '.cs-marquee');
    expect(marquee).toBeDefined();
    expect(marquee!.body).toMatch(/color:\s*var\(--cs-accent-on\)/);
    expect(marquee!.body).toMatch(/background:\s*var\(--cs-accent\)/);
  });
});
