import { nullOutDecision, minutesOfDay } from './null-out-gate';

// 2026-09-15 05:40 ET is 09:40 UTC (EDT, UTC-4).
const et = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 8, 15, h + 4, m));
};

describe('reading the wall clock in Eastern time', () => {
  it('reports ET, not UTC — the whole schedule is written in ET', () => {
    expect(minutesOfDay(et('05:40'))).toBe(5 * 60 + 40);
    expect(minutesOfDay(et('06:00'))).toBe(6 * 60);
  });

  it('handles midnight without wrapping to 1440', () => {
    expect(minutesOfDay(et('00:00'))).toBe(0);
  });
});

describe('the decision', () => {
  it('runs as soon as the move has covered the corpus', () => {
    expect(nullOutDecision({ now: et('05:31'), unmoved: 0 })).toBe('run');
    expect(nullOutDecision({ now: et('06:00'), unmoved: 0 })).toBe('run');
  });

  it('waits while the mover is still going and the deadline has not passed', () => {
    expect(nullOutDecision({ now: et('05:40'), unmoved: 400_000 })).toBe('wait');
    expect(nullOutDecision({ now: et('05:47'), unmoved: 1 })).toBe('wait');
  });

  it('stands down at the deadline rather than clearing a half-moved corpus', () => {
    // One row short is still short: the null-out would have to run again anyway, against a
    // table that is by then partly cleared.
    expect(nullOutDecision({ now: et('05:48'), unmoved: 1 })).toBe('skip');
    expect(nullOutDecision({ now: et('06:00'), unmoved: 1 })).toBe('skip');
  });

  it('takes the deadline as a parameter, so a slower night can be given more room', () => {
    expect(nullOutDecision({ now: et('05:50'), unmoved: 10, deadline: '05:55' })).toBe('wait');
    expect(nullOutDecision({ now: et('05:56'), unmoved: 10, deadline: '05:55' })).toBe('skip');
  });

  it('refuses a malformed deadline instead of defaulting to something', () => {
    expect(() => nullOutDecision({ now: et('05:50'), unmoved: 1, deadline: 'soon' })).toThrow();
  });
});
