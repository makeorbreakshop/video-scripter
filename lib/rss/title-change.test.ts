import {
  titleVersionPlan,
  classifyTitleDiff,
  TITLE_EVIDENCE_WINDOW_DAYS,
} from './title-change';

const NOW = new Date('2026-09-03T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const days = (d: number) => d * 86_400_000;

describe('titleVersionPlan', () => {
  it('seeds the old title as v1 the first time a video ever differs', () => {
    expect(titleVersionPlan(0)).toEqual({ seedVersion1: true, newVersion: 2 });
  });

  it('just appends once the video has history', () => {
    expect(titleVersionPlan(1)).toEqual({ seedVersion1: false, newVersion: 2 });
    expect(titleVersionPlan(9)).toEqual({ seedVersion1: false, newVersion: 10 });
  });

  it('never produces version 1 for the newly observed title (feed events need version > 1)', () => {
    for (let v = 0; v < 5; v++) expect(titleVersionPlan(v).newVersion).toBeGreaterThan(1);
  });
});

describe('classifyTitleDiff', () => {
  it('is a CHANGE for a video published inside the evidence window', () => {
    // We have watched it since launch, so the title we hold is the one it launched with.
    expect(classifyTitleDiff({ publishedAt: ago(days(1)), titleObservedAt: null }, NOW)).toBe('change');
    expect(classifyTitleDiff({ publishedAt: ago(days(6.9)), titleObservedAt: null }, NOW)).toBe('change');
  });

  it('is a CHANGE for an old video whose title we observed inside the window', () => {
    expect(classifyTitleDiff({ publishedAt: ago(days(400)), titleObservedAt: ago(days(2)) }, NOW)).toBe('change');
    expect(classifyTitleDiff({ publishedAt: ago(days(400)), titleObservedAt: ago(days(6.9)) }, NOW)).toBe('change');
  });

  // This is the bug the first full-corpus pass shipped: 329 of 708 events were videos over six
  // months old that we had simply never looked at before.
  it('is a SYNC for an old video we have never observed', () => {
    expect(classifyTitleDiff({ publishedAt: ago(days(400)), titleObservedAt: null }, NOW)).toBe('sync');
    expect(classifyTitleDiff({ publishedAt: ago(days(200)), titleObservedAt: undefined }, NOW)).toBe('sync');
  });

  it('is a SYNC for an old video whose last observation has gone stale', () => {
    expect(classifyTitleDiff({ publishedAt: ago(days(400)), titleObservedAt: ago(days(8)) }, NOW)).toBe('sync');
    expect(classifyTitleDiff({ publishedAt: ago(days(400)), titleObservedAt: ago(days(365)) }, NOW)).toBe('sync');
  });

  it('is a SYNC when we know nothing at all about the video', () => {
    expect(classifyTitleDiff({ publishedAt: null, titleObservedAt: null }, NOW)).toBe('sync');
  });

  it('uses a 7-day window on both halves of the rule', () => {
    expect(TITLE_EVIDENCE_WINDOW_DAYS).toBe(7);
    expect(classifyTitleDiff({ publishedAt: ago(days(7.1)), titleObservedAt: ago(days(7.1)) }, NOW)).toBe('sync');
    expect(classifyTitleDiff({ publishedAt: ago(days(7.1)), titleObservedAt: ago(days(6.9)) }, NOW)).toBe('change');
  });
});
