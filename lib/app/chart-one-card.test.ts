// A test or a swap has exactly ONE representation on the video page.
//
// Brandon, on the v5 chart: "fix the chart where it pops open at the top, that was older code
// and it competes; for a thumbnail test we just have the one inline, not the top thing."
//
// The older code was a card that opened between the chart and the packaging strip whenever the
// cursor touched a marker — "Thumbnail detected at 21h" over two 120px variants, side by side.
// It said the same thing the strip's entry says, in a different shape, in a place the reader
// was not looking, and it moved the strip down the page as it appeared. What a test looks like
// now: the shaded window on the plot with its chip, and its entry in the strip. Hovering the
// window highlights both and shows the chart's own small tooltip; clicking it opens and scrolls
// to the strip entry. Nothing else opens.
//
// A SOURCE test, like chart-copy: the panel cannot come back by being added to a branch nobody
// screenshots.
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

const CHART_FILES = [
  'components/app/video-chart-plot.tsx',
  'components/app/video-chart.tsx',
  'app/app/videos/[id]/page.tsx',
];
const chartSource = () => CHART_FILES.map(read).join('\n');

/** The panel's own machinery, and every label it wrote. */
const GONE = [
  'hoveredMarker',
  'detected at',
  'Thumbnail detected',
  'thumbnail v',
];

describe('the chart opens no card of its own', () => {
  it.each(GONE)('has no "%s" anywhere in the chart source', (s) => {
    expect(chartSource()).not.toContain(s);
  });

  /**
   * The panel was the only thing on the chart that drew an image, and its props are gone with
   * it: the plot is handed the packaging MARKS (chart-marks/packaging-groups, the strip's own
   * grouping) and nothing else about packaging.
   */
  it('renders no thumbnail in the plot, and is handed no thumbnails to render', () => {
    const plot = read('components/app/video-chart-plot.tsx');
    expect(plot).not.toContain('<Thumb');
    expect(plot).not.toContain('thumbUrls');
    expect(plot).not.toMatch(/\bmarkers\b/);
  });

  /** The hit test still exists — a click on a window opens the strip entry, and only that. */
  it('keeps the click that opens the strip entry', () => {
    const plot = read('components/app/video-chart-plot.tsx');
    expect(plot).toContain('markAt(');
    expect(plot).toContain('setOpened(');
  });
});

// The payload half: with the panel gone, nothing on the page reads the experiment verdicts or
// the raw change markers, so the page no longer computes or ships either. lib/app/experiment.ts
// itself stays — /api/v1/videos/[id] is its remaining caller.
describe('the video page payload carries only what the chart and the strip read', () => {
  const src = read('lib/app/video-page.ts');

  it('has no experiments field and does not import the experiment read', () => {
    expect(src).not.toMatch(/experiments\s*[:(]/);
    expect(src).not.toContain("from './experiment'");
  });

  it('has no markers field: the strip and the chart share packagingGroups/marks instead', () => {
    expect(src).not.toMatch(/^\s*markers[:,]/m);
    expect(src).not.toContain('packagingMarkers');
    expect(src).toContain('packagingGroups');
    expect(src).toContain('marks:');
  });

  it('leaves lib/app/experiment.ts in place for the API that still calls it', () => {
    expect(read('app/api/v1/videos/[id]/route.ts')).toContain("from '@/lib/app/experiment'");
  });
});
