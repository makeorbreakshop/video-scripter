import { titleVersionPlan } from './title-change';

describe('titleVersionPlan', () => {
  it('seeds the old title as v1 the first time a video ever changes title', () => {
    expect(titleVersionPlan(0)).toEqual({ seedVersion1: true, newVersion: 2 });
  });

  it('just appends once the video has history', () => {
    expect(titleVersionPlan(1)).toEqual({ seedVersion1: false, newVersion: 2 });
    expect(titleVersionPlan(2)).toEqual({ seedVersion1: false, newVersion: 3 });
    expect(titleVersionPlan(9)).toEqual({ seedVersion1: false, newVersion: 10 });
  });

  it('never produces version 1 for the newly observed title (feed events need version > 1)', () => {
    for (let v = 0; v < 5; v++) expect(titleVersionPlan(v).newVersion).toBeGreaterThan(1);
  });
});
