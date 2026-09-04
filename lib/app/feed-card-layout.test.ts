/**
 * The feed card's layout contract.
 *
 * feed-card.tsx says "the unit inside every card is a small YouTube card — thumbnail, title
 * under it — at one fixed width", and theme.css then gave an upload 560px and a swap 400px, so
 * the same video appeared at two sizes in one scrolling column. The upload variant also put
 * the stats in a column beside a 315px-tall thumbnail, leaving a 294×229 hole on every card,
 * and pushed the title below all of it — last in the reading order, on a product about
 * packaging.
 *
 * The 375px layout already had this right: byline, thumbnail, title, then the numbers. These
 * tests hold desktop to the same order.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = strip(readFileSync(join(ROOT, 'app/app/theme.css'), 'utf8'));
const CARD = readFileSync(join(ROOT, 'app/app/_components/feed-card.tsx'), 'utf8');

function declared(selector: string, prop: string): string | null {
  const re = new RegExp(`(^|\\})\\s*${selector.replace(/[.[\]"^$]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const m = CSS.match(re);
  if (!m) return null;
  const d = m[2].match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`));
  return d ? d[1].trim() : null;
}

describe('one video unit, one width', () => {
  it('gives every card kind the same .cs-vid width', () => {
    // The override that made an upload's thumbnail 40% wider than a swap's.
    expect(CSS).not.toMatch(/\.cs-fcard-row\[data-upload\]\s*\.cs-vid\s*\{[^}]*width:/);
  });

  it('sizes the unit by the column, not by a fixed pixel width', () => {
    // A fixed 400px was a second magic number that stopped tracking the container.
    const width = declared('.cs-vid', 'width');
    expect(width).toBe('100%');
  });
});

describe('reading order', () => {
  it('puts the title with its thumbnail, above the numbers', () => {
    // <Go> renders the thumbnail and title as one unit; the stats follow it in the DOM.
    const upload = CARD.slice(CARD.indexOf('data-upload'));
    const vid = upload.indexOf('{vid(');
    const stats = upload.indexOf('{stats}');
    expect(vid).toBeGreaterThanOrEqual(0);
    expect(stats).toBeGreaterThan(vid);
  });

  it('stacks the upload row rather than putting the numbers in a side column', () => {
    // The side column is what left the hole: an 86px-tall block beside a 315px thumbnail.
    expect(declared('.cs-fcard-row[data-upload]', 'flex-direction')).toBe('column');
  });
});

describe('the score slot keeps its shape', () => {
  it('never renders a sentence where the numeral goes', () => {
    // Unscored cards used to put "Not enough <channel> history yet for a baseline" in the
    // 26px numeral slot, which read as a broken card and gave every row a different height.
    // The reason belongs in the slot's title, and formatScore already returns an em dash.
    expect(CARD).not.toMatch(/cs-fcard-score[^>]*>\s*\{[^}]*scoreNote/);
    expect(CARD).toMatch(/className="cs-num cs-fcard-score"/);
  });
});
