/**
 * One product, one name, one mark, one green.
 *
 * The repo shipped five product names (ChannelSmith, ChannelSmith Admin, YouTube Script Editor,
 * Thumbnail Battle, "Channel Ingest (personal)"), six greens, and no favicon or OG image for
 * anything but /thumbnail-battle — so every ChannelSmith page had the browser's blank default
 * in the tab and a shared link previewed as nothing. The root <title> was still the name of a
 * product that no longer exists, carried on every public page.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { BRAND } from './brand';

const ROOT = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('the mark exists', () => {
  it('has a favicon at the app root, not only under /thumbnail-battle', () => {
    expect(existsSync(join(ROOT, 'app/icon.tsx'))).toBe(true);
  });

  it('has an Open Graph image, so a shared link previews as something', () => {
    expect(existsSync(join(ROOT, 'app/opengraph-image.tsx'))).toBe(true);
  });

  it('has a source SVG both can be drawn from', () => {
    expect(existsSync(join(ROOT, 'public/mark.svg'))).toBe(true);
  });
});

describe('the name', () => {
  it('is on the root layout — no page inherits a retired product name', () => {
    const layout = read('app/layout.tsx');
    // Taken from BRAND rather than spelled out, so renaming the product is one edit.
    expect(layout).toMatch(/title:\s*\{[^}]*BRAND\.name/);
    expect(layout).not.toContain('YouTube Script Editor');
  });

  it('does not advertise the scaffolding tool that generated the first draft', () => {
    expect(read('app/layout.tsx')).not.toMatch(/generator:\s*'v0\.dev'/);
  });

  it('is the name the browser extension installs under', () => {
    const manifest = JSON.parse(read('chrome-extension/manifest.json'));
    expect(manifest.name).toContain(BRAND.name);
    expect(manifest.action.default_title).toContain(BRAND.name);
  });
});

describe('one green', () => {
  /**
   * --cs-accent in theme.css is the brand green, dark-mode and light-mode variants of the same
   * role. Everything user-facing outside the two thumbnail-battle palettes must use it rather
   * than a literal, or a prospect's first green — the CTA on the root page — ends up being a
   * different colour from the product's.
   */
  const SURFACES = ['app/page.tsx', 'public/mark.svg', 'app/icon.tsx', 'app/opengraph-image.tsx'];

  it.each(SURFACES)('%s uses no raw lime literal', (rel) => {
    expect(read(rel)).not.toMatch(/#00ff00/i);
  });

  it('states the accent once, so the OG image and the favicon cannot drift from the CSS', () => {
    const theme = read('app/app/theme.css');
    expect(theme).toContain(BRAND.accent);
    expect(theme).toContain(BRAND.accentDark);
  });
});
