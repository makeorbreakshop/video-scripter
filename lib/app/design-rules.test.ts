/**
 * The written design rules, made mechanical.
 *
 * app/app/layout.tsx says of the pixel face: "for the wordmark, the score numerals, the NEW
 * HIGH SCORE tag and the onboarding step chips only — never body text, headings or labels."
 * components/app/CONTROLS.md names five controls and one shared height. Both were prose, and
 * both had drifted: "NOTIFYING" and the "YOU" badge had taken the pixel face at 7–8px, and
 * the rendered app had seven control heights against a registry that declares one.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '');

const CSS = strip(read('app/app/theme.css'));

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

describe('the pixel face stays rare', () => {
  /**
   * Every selector allowed to set --font-pixel, and why. The face carries meaning by being
   * scarce: it says "this is a score, or the cabinet itself". A plan tier, a channel badge or
   * a meter label is none of those, and at 7–8px Press Start 2P is barely legible anyway.
   */
  const ALLOWED = new Set([
    '.cs-marquee',   // the wordmark plate — the product name on the cabinet
    '.cs-hiscore',   // the NEW HIGH SCORE tag
    '.cs-step',      // onboarding step chips
    '.cs-coin',      // the insert-coin screen
    '.cs-coin-sub',  // and its subtitle — the same arcade moment
  ]);

  it('is set on the allowlist and nothing else', () => {
    const users = rules()
      .filter((r) => /font-family:\s*var\(--font-pixel\)/.test(r.body))
      .map((r) => r.selector);
    expect(new Set(users)).toEqual(ALLOWED);
  });

  it('never falls below 8px, where the face stops being readable', () => {
    for (const r of rules().filter((x) => /var\(--font-pixel\)/.test(x.body))) {
      const size = r.body.match(/font-size:\s*(\d+(?:\.\d+)?)px/);
      if (size) expect(Number(size[1])).toBeGreaterThanOrEqual(8);
    }
  });

  it('is not borrowed by non-score copy in the app source', () => {
    // .cs-hiscore was carrying "current plan" on the settings page: the high-score tag used
    // as a caption. If a label needs the mono face, it should ask for .cs-num.
    const offenders: string[] = [];
    for (const rel of ['app/app/_components/settings-client.tsx']) {
      const src = strip(read(rel));
      for (const [, text] of src.matchAll(/className="cs-hiscore"[^>]*>([^<]*)</g)) {
        if (!/high\s*score/i.test(text)) offenders.push(`${rel}: ${text.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('one control height scale', () => {
  /**
   * CONTROLS.md now declares the scale rather than one shared control: 22px for the per-row
   * coin, 30px for filters and menus, 36px for buttons and the wordmark plate. Anything else
   * is a one-off, which is how Inspiration ended up with its own 38px segmented control.
   */
  const SCALE = [22, 30, 36];

  it('is documented in CONTROLS.md', () => {
    const doc = read('components/app/CONTROLS.md');
    for (const h of SCALE) expect(doc).toContain(`${h}px`);
  });

  it('is the only set of fixed heights theme.css sets on a control', () => {
    const CONTROLS = /^\.(cs-control|cs-btn|cs-chip|cs-coin-toggle|cs-icon-btn|cs-marquee|cs-menu-trigger|cs-tab)\b/;
    const offenders = rules()
      .filter((r) => CONTROLS.test(r.selector))
      .map((r) => ({ selector: r.selector, height: r.body.match(/(?:^|[;\s])height:\s*(\d+)px/) }))
      .filter((r) => r.height && !SCALE.includes(Number(r.height![1])))
      .map((r) => `${r.selector} → ${r.height![1]}px`);
    expect(offenders).toEqual([]);
  });
});

describe('one way to say "selected"', () => {
  /**
   * There were five: chip (ink fill), coin (accent fill), Inspiration's mode (accent tint),
   * tab (ink underline) and nav (surface-2 pill). Three survive, each for a structurally
   * different job: a filter that is on, a boolean that is on, and a location you are at.
   * A page-level stylesheet inventing a fourth is the drift this catches.
   */
  it('has no accent-tinted selected state outside the coin', () => {
    const offenders = rules()
      .filter((r) => /\[data-on|:has\(input:checked\)|\[aria-pressed="true"\]/.test(r.selector))
      .filter((r) => /background:\s*var\(--cs-accent-soft\)/.test(r.body))
      .map((r) => r.selector);
    expect(offenders).toEqual([]);
  });

  it('is not redefined by any page-level CSS module', () => {
    // A page that needs a filter row uses <Chips>; it does not grow its own.
    const mod = strip(read('app/app/inspiration/inspiration.module.css'));
    expect(mod).not.toMatch(/:has\(input:checked\)/);
    expect(mod).not.toMatch(/--cs-accent-soft/);
  });
});
