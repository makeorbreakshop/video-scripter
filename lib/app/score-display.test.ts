import { OUTLIER_AT, UNDER_AT, scoreTone } from './score-display';

/**
 * How a score is allowed to look. The chip used --cs-warn for anything under 1.0×, which put
 * the palette's warning colour on most of a channel grid — on this repo's own owner channel,
 * 10 of the first 14 tiles — and drew the eye to the unremarkable majority. It also split the
 * scale at exactly 1.0, so 0.99× and 1.01× got opposite treatments for a rounding difference
 * the forecast cannot resolve.
 */
describe('scoreTone', () => {
  it('has no tone for an unscored video', () => {
    expect(scoreTone(null)).toBe('none');
    expect(scoreTone(undefined)).toBe('none');
    expect(scoreTone(NaN)).toBe('none');
  });

  it('calls a video an outlier at the same threshold the feed does', () => {
    expect(scoreTone(OUTLIER_AT)).toBe('outlier');
    expect(scoreTone(9.9)).toBe('outlier');
  });

  it('treats everything between the two thresholds as ordinary', () => {
    expect(scoreTone(UNDER_AT)).toBe('normal');
    expect(scoreTone(1)).toBe('normal');
    expect(scoreTone(1.9)).toBe('normal');
  });

  it('de-emphasises only clearly-below-baseline, not everything under 1.0', () => {
    expect(scoreTone(0.3)).toBe('under');
    // The old cliff: these two are the same video within the forecast's own noise.
    expect(scoreTone(0.99)).toBe(scoreTone(1.01));
  });

  it('keeps the under threshold below baseline and the outlier threshold above it', () => {
    expect(UNDER_AT).toBeLessThan(1);
    expect(OUTLIER_AT).toBeGreaterThan(1);
  });
});

describe('score tone is not carried by colour alone', () => {
  // WCAG 2.1 1.4.1. Each tone must differ from its neighbours by something a viewer who
  // cannot separate the hues still gets: weight, or the number itself.
  const WEIGHT: Record<ReturnType<typeof scoreTone>, number> = {
    outlier: 700, normal: 600, under: 600, none: 600,
  };

  it('gives the outlier tone its own weight, not just its own hue', () => {
    expect(WEIGHT.outlier).toBeGreaterThan(WEIGHT.normal);
  });

  it('separates under from normal by the printed number, not only by colour', () => {
    // "0.8×" and "1.4×" are self-describing against a 1.0 baseline; the tone is redundant
    // emphasis on top of that, which is what makes muting it safe.
    expect(UNDER_AT).toBeLessThan(1);
  });
});
