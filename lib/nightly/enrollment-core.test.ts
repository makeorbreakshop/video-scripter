import { planEnrollment, isTracked, KnownChannels } from './enrollment-core';

const CHRIS = 'UCvVsD2hFZRgKNH7x5Q1wwug'; // in competitor list + corpus, NOT in discovered_channels
const NEWBIE = 'UCnewchannel000000000000';

function known(over: Partial<KnownChannels> = {}): KnownChannels {
  return {
    competitor: new Set(),
    discovered: new Set(),
    legacy: new Set(),
    withVideos: new Set(),
    ...over,
  };
}

describe('isTracked — the Chris Young regression', () => {
  it('a channel in the competitor list is tracked even with no discovered_channels row', () => {
    expect(isTracked(CHRIS, known({ competitor: new Set([CHRIS]) }))).toBe(true);
  });

  it('a channel known only through corpus videos is tracked', () => {
    expect(isTracked(CHRIS, known({ withVideos: new Set([CHRIS]) }))).toBe(true);
  });

  it('a channel only in the legacy channels table is tracked', () => {
    expect(isTracked(CHRIS, known({ legacy: new Set([CHRIS]) }))).toBe(true);
  });

  it('an unknown channel is not tracked', () => {
    expect(isTracked(NEWBIE, known())).toBe(false);
  });
});

describe('planEnrollment', () => {
  it('does NOT enroll an already-tracked channel; labels the queue row instead', () => {
    const plan = planEnrollment(
      [{ queueId: 1, channelId: CHRIS }],
      known({ competitor: new Set([CHRIS]) })
    );
    expect(plan.toEnroll).toEqual([]);
    expect(plan.results.get(1)).toBe(`already-tracked:${CHRIS}`);
  });

  it('enrolls a genuinely new channel exactly once even from many captures', () => {
    const plan = planEnrollment(
      [
        { queueId: 1, channelId: NEWBIE },
        { queueId: 2, channelId: NEWBIE },
        { queueId: 3, channelId: NEWBIE },
      ],
      known()
    );
    expect(plan.toEnroll).toEqual([NEWBIE]);
    expect(plan.results.get(1)).toBe(`enrolled:${NEWBIE}`);
    expect(plan.results.get(3)).toBe(`enrolled:${NEWBIE}`);
  });

  it('marks unresolvable captures without enrolling anything', () => {
    const plan = planEnrollment([{ queueId: 9, channelId: null }], known());
    expect(plan.toEnroll).toEqual([]);
    expect(plan.results.get(9)).toBe('unresolved');
  });

  it('mixed batch: tracked, new, and unresolved each get the right outcome', () => {
    const plan = planEnrollment(
      [
        { queueId: 1, channelId: CHRIS },
        { queueId: 2, channelId: NEWBIE },
        { queueId: 3, channelId: null },
      ],
      known({ withVideos: new Set([CHRIS]) })
    );
    expect(plan.toEnroll).toEqual([NEWBIE]);
    expect(plan.results.get(1)).toBe(`already-tracked:${CHRIS}`);
    expect(plan.results.get(2)).toBe(`enrolled:${NEWBIE}`);
    expect(plan.results.get(3)).toBe('unresolved');
  });
});
