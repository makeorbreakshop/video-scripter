import { ageLabel, ago } from './format';

describe('ageLabel', () => {
  const now = new Date('2026-09-02T12:00:00Z').getTime();
  test('shows hours under a day rather than 0d', () => {
    expect(ageLabel('2026-09-01T13:00:00Z', now)).toBe('23h old');
    expect(ageLabel('2026-09-02T11:00:00Z', now)).toBe('1h old');
  });
  test('shows minutes under an hour', () => {
    expect(ageLabel('2026-09-02T11:40:00Z', now)).toBe('20m old');
  });
  test('shows days from one day on', () => {
    expect(ageLabel('2026-09-01T12:00:00Z', now)).toBe('1d old');
    expect(ageLabel('2026-08-20T12:00:00Z', now)).toBe('13d old');
  });
  test('handles missing input', () => { expect(ageLabel(null, now)).toBe('–'); });
});

describe('ago', () => {
  const now = new Date('2026-09-02T12:00:00Z').getTime();
  test('reports minutes, hours and days back from the given instant', () => {
    expect(ago('2026-09-02T11:49:00Z', now)).toBe('11m ago');
    expect(ago('2026-09-02T00:00:00Z', now)).toBe('12h ago');
    expect(ago('2026-08-28T12:00:00Z', now)).toBe('5d ago');
  });
});
