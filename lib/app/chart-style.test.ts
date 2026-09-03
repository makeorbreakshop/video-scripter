// Correction: the implied PAST and the FORECAST future were both accent-green dashed lines with
// an accent band, so a reader could not tell reconstruction from projection. This is the map
// from series kind to how it is drawn — the one place the two are made to look different.
import { seriesStyle, SERIES_LABELS, trackingBeganLabel } from './chart-style';

describe('a series kind decides how it is drawn, and the kinds do not look alike', () => {
  it('draws the reconstructed past muted and dotted, with no band', () => {
    const s = seriesStyle('implied');
    expect(s.strokeToken).toBe('muted');
    expect(s.dash).toBe('2 3');       // dotted
    expect(s.band).toBe(false);
    expect(s.opacity).toBeLessThan(1);
  });

  it('draws the forecast in the accent colour, dashed, with its band', () => {
    const s = seriesStyle('forecast');
    expect(s.strokeToken).toBe('accent');
    expect(s.dash).toBe('5 4');       // dashed, not dotted
    expect(s.band).toBe(true);
  });

  it('draws the measured line solid, in the accent colour, at full weight', () => {
    const s = seriesStyle('measured');
    expect(s.strokeToken).toBe('accent');
    expect(s.dash).toBeUndefined();
    expect(s.band).toBe(false);
    expect(s.width).toBeGreaterThan(seriesStyle('implied').width);
  });

  it('gives the past and the future different strokes on every axis a reader could use', () => {
    const past = seriesStyle('implied'), future = seriesStyle('forecast');
    expect(past.strokeToken).not.toBe(future.strokeToken);
    expect(past.dash).not.toBe(future.dash);
    expect(past.band).not.toBe(future.band);
  });

  it('names the series in plain language, not model words', () => {
    expect(SERIES_LABELS.implied).toBe('before we started tracking (estimated)');
    expect(SERIES_LABELS.forecast).toBe('expected from here');
    expect(SERIES_LABELS.measured).toBe('this video');
    expect(SERIES_LABELS.expected).toBe('typical for this channel');
    for (const v of Object.values(SERIES_LABELS)) expect(v).toBe(v.toLowerCase());
  });
});

describe('the chart says when tracking began', () => {
  // Malecki XplV_L7gx6w: published Aug 29 07:12 ET, first measurement day 3.48.
  const PUB = '2026-08-29T11:12:40.000Z';

  it('labels the first measurement with its ET date', () => {
    expect(trackingBeganLabel(PUB, 3.48)).toBe('tracking began Sep 1');
  });

  it('uses ET, not UTC, for a measurement that lands late in the evening', () => {
    // 2026-09-01T03:30Z is Aug 31, 11:30 PM ET
    expect(trackingBeganLabel('2026-09-01T00:00:00.000Z', 0.1458)).toBe('tracking began Aug 31');
  });

  it('says nothing when there is nothing measured, or no publish time', () => {
    expect(trackingBeganLabel(PUB, null)).toBeNull();
    expect(trackingBeganLabel(null, 3.48)).toBeNull();
    expect(trackingBeganLabel('nonsense', 3.48)).toBeNull();
  });

  it('says nothing when tracking started at publish — there is no reconstructed past to explain', () => {
    expect(trackingBeganLabel(PUB, 0.02)).toBeNull();
  });
});
