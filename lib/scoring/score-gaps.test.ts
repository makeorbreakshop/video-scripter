// Invariant 3: every long-form video under 90 days has a non-null score, or a named reason.
import { gapBucket, GAP_BUCKETS, isFixable, gapReasonWords, type GapFacts } from './score-gaps';

const base: GapFacts = {
  ageDays: 10, hasScoreRow: true, score: null, nBaseline: 0,
  observations: 5, priorLongform: 12, viewCount: 1000,
};

describe('gapBucket names one cause per unscored video', () => {
  it('a 60-90 day video with no score row at all is waiting on the --final pass', () => {
    expect(gapBucket({ ...base, ageDays: 74, hasScoreRow: false, observations: 0 }))
      .toBe('outside-scoring-window');
    // ...but only when there is a lifetime count for --final to normalize
    expect(gapBucket({ ...base, ageDays: 74, hasScoreRow: false, observations: 0, viewCount: 0 }))
      .toBe('no-observations');
  });

  it('a young video the tracker never measured has no observations to score', () => {
    expect(gapBucket({ ...base, ageDays: 4, observations: 0, hasScoreRow: false })).toBe('no-observations');
  });

  it('a channel with fewer than three prior long-form videos has no baseline', () => {
    expect(gapBucket({ ...base, priorLongform: 2 })).toBe('no-channel-baseline');
    expect(gapBucket({ ...base, priorLongform: 0 })).toBe('no-channel-baseline');
  });

  it('priors that exist but yield no day-30 estimate are their own cause', () => {
    expect(gapBucket({ ...base, priorLongform: 12, nBaseline: 2 })).toBe('priors-unusable');
  });

  it('a young video inside the window with everything it needs was simply skipped', () => {
    expect(gapBucket({ ...base, ageDays: 8, hasScoreRow: false, nBaseline: 0 })).toBe('never-scored-in-window');
  });

  it('a video that already has a score is not a gap at all', () => {
    expect(gapBucket({ ...base, score: 2.5, nBaseline: 9 })).toBeNull();
  });

  it('every bucket it can return is declared', () => {
    const facts: GapFacts[] = [
      { ...base, ageDays: 74, hasScoreRow: false, observations: 0 },
      { ...base, observations: 0 },
      { ...base, priorLongform: 1 },
      { ...base, nBaseline: 2 },
      { ...base, hasScoreRow: false },
      { ...base },
    ];
    for (const f of facts) expect(GAP_BUCKETS).toContain(gapBucket(f)!);
  });

  it('separates the buckets a run can close from the ones that are genuinely too little data', () => {
    expect(isFixable('outside-scoring-window')).toBe(true);
    expect(isFixable('never-scored-in-window')).toBe(true);
    expect(isFixable('no-observations')).toBe(true);
    expect(isFixable('no-channel-baseline')).toBe(false);
    expect(isFixable('priors-unusable')).toBe(false);
  });
});

describe('an unscorable video says why, in words', () => {
  it('names the channel and the missing history rather than showing nothing', () => {
    expect(gapReasonWords('no-channel-baseline', 'Jay Clouse'))
      .toBe('Not enough Jay Clouse history yet for a baseline');
    expect(gapReasonWords('priors-unusable', 'Jay Clouse'))
      .toBe("Jay Clouse's recent videos are still too young to set a baseline");
    expect(gapReasonWords('no-observations', 'Jay Clouse'))
      .toBe('No view measurements yet — the first lands within a day');
  });

  it('falls back to a channel-free sentence when the name is missing', () => {
    expect(gapReasonWords('no-channel-baseline', null)).toBe('Not enough channel history yet for a baseline');
  });

  it('says something for every bucket', () => {
    for (const b of GAP_BUCKETS) expect(gapReasonWords(b, 'X').length).toBeGreaterThan(10);
  });
});
