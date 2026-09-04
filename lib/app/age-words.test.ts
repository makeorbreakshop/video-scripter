import { sameAge } from './age-words';

describe('sameAge', () => {
  it('reads a young video in hours and an older one in days', () => {
    expect(sameAge(0.5)).toBe('12h');
    expect(sameAge(1)).toBe('24h');
    expect(sameAge(3)).toBe('3d');
    expect(sameAge(30)).toBe('30d');
  });

  it('never prints "0h" for a video that exists', () => {
    expect(sameAge(0.001)).toBe('1h');
  });

  it('has no words for a nonsense age', () => {
    expect(sameAge(-1)).toBe('–');
    expect(sameAge(NaN)).toBe('–');
  });
});
