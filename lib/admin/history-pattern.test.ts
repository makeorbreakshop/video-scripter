import { patternSummary, PATTERN_MAX } from './history-pattern';

/**
 * The admin overview's History column joined every version label with an arrow and no cap, so
 * a video that had rotated twenty times rendered "A → B → A → B →" past the right edge of the
 * viewport with no scroll container. Meanwhile the Video column, which had real content, was
 * squeezed to about 50px and wrapped titles onto six lines.
 */
describe('patternSummary', () => {
  it('leaves a short history exactly as it was', () => {
    expect(patternSummary(['A', 'B'])).toBe('A → B');
    expect(patternSummary(['A', 'B', 'A'])).toBe('A → B → A');
  });

  it('caps a long history and says how much it dropped', () => {
    const labels = Array.from({ length: PATTERN_MAX + 5 }, (_, i) => (i % 2 ? 'B' : 'A'));
    const out = patternSummary(labels);
    expect(out.split(' → ')).toHaveLength(PATTERN_MAX + 1);
    // The elision reads first, in chronological order: "+5 more → A → B → …".
    expect(out.startsWith('+5 more → ')).toBe(true);
  });

  it('keeps the most recent versions, which are the ones being looked at', () => {
    const out = patternSummary(['X', ...Array.from({ length: PATTERN_MAX }, () => 'Z'), 'LAST']);
    expect(out.startsWith('+2 more')).toBe(true);
    expect(out.endsWith('LAST')).toBe(true);
  });

  it('handles the empty and single cases without a stray arrow', () => {
    expect(patternSummary([])).toBe('');
    expect(patternSummary(['A'])).toBe('A');
  });
});
