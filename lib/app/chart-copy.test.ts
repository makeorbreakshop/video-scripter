// The chart has no words on it that are not data.
//
// Brandon, on the v4 chart: "so many words on here doing basically nothing". A corner hint
// telling the reader to drag, a reset chip, a sentence under the plot apologising for a missing
// baseline, another one explaining when the first snapshot lands. None of them are a number, a
// date or a name — they are the interface narrating itself, and they are gone.
//
// This is a SOURCE test rather than a render test on purpose: the copy cannot come back by
// being added to a branch nobody screenshots. If a string like this is wanted again, this test
// is the conversation about it.
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const FILES = [
  'components/app/video-chart-plot.tsx',
  'components/app/video-chart.tsx',
  'lib/app/chart-zoom.ts',
  'lib/app/chart-brush.ts',
  'lib/app/chart-style.ts',
];

const source = () => FILES.map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');

/** The exact strings the v4 chart carried, and every spelling of them we have written. */
const BANNED = [
  'drag to zoom',
  'double-click to reset',
  'ZOOM_HINT',
  'Baseline not available yet',
  'No view data yet',
  'the first snapshot lands',
  'showing this video',
];

describe('no explainer copy on or around the chart', () => {
  it.each(BANNED)('has no "%s" anywhere in the chart source', (s) => {
    expect(source()).not.toContain(s);
  });

  it('offers no reset control: the brush track is double-clicked instead', () => {
    const plot = readFileSync(join(ROOT, 'components/app/video-chart-plot.tsx'), 'utf8');
    expect(plot).not.toMatch(/>\s*reset\s*</);
  });

  /**
   * The whitelist, as a test. Every user-visible literal in the plot is one of: an axis tick, a
   * legend name, the scale toggle, a chip value, the tracking label, or an A/B chip — and all
   * of those are built from data or from the label tables in chart-style/chart-zoom, never
   * written inline here. So the plot itself should contain no prose literal at all: nothing in
   * quotes with a space in it that is not a CSS value, a selector or an ARIA string.
   */
  it('writes no sentence into the plot component', () => {
    const plot = readFileSync(join(ROOT, 'components/app/video-chart-plot.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments are for us, not the reader
      .replace(/^\s*\/\/.*$/gm, '');
    // A sentence is three or more words, ending in a letter or a full stop, inside a JSX text
    // node — which is the only place prose could reach the page from this file.
    const jsxText = plot.match(/>[^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*</g) ?? [];
    const prose = jsxText
      .map((s) => s.slice(1, -1).trim())
      .filter((s) => /\s/.test(s) && s.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w)).length >= 3);
    expect(prose).toEqual([]);
  });
});
