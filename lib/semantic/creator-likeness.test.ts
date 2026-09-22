import fs from 'node:fs';
import {
  creatorLikenessFloor, clearCreatorLikenessCache, CREATOR_LIKENESS_FILE,
  likenessScores, mergeLikenessPayload, type TrackedVector,
} from './creator-likeness';

describe('the creator-likeness floor', () => {
  afterEach(() => { clearCreatorLikenessCache(); jest.restoreAllMocks(); });

  it('is the number the script wrote', () => {
    clearCreatorLikenessCache();
    expect(creatorLikenessFloor()?.floor).toBe(
      JSON.parse(fs.readFileSync(CREATOR_LIKENESS_FILE, 'utf8')).floor
    );
  });

  // A board that silently empties is worse than a board that shows too much: the filter is an
  // improvement on the corpus, not a correctness guarantee, so a missing measurement disables it.
  it('is null when the file is missing, which callers read as "do not filter"', () => {
    clearCreatorLikenessCache();
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('ENOENT'); });
    expect(creatorLikenessFloor()).toBeNull();
  });
});

// Directions on the unit circle, so every expected cosine is something you can work out by hand.
const at = (degrees: number): number[] => {
  const r = (degrees * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
};
const tracked = (entries: Array<[string, number]>): TrackedVector[] =>
  entries.map(([channel_id, degrees]) => ({ channel_id, vector: at(degrees) }));

describe('likenessScores', () => {
  it('is the mean cosine to the k nearest tracked channels', () => {
    const scores = likenessScores(
      new Map([['probe', at(0)]]),
      tracked([['a', 0], ['b', 60], ['c', 90], ['d', 180]]),
      2,
    );
    // cos 0 = 1 and cos 60 = 0.5 are the two nearest; 90 and 180 are not counted.
    expect(scores.get('probe')).toBeCloseTo(0.75, 6);
  });

  // A tracked channel scored against itself would always read 1.0 and make the floor meaningless.
  it('excludes the channel itself when it is in the tracked set', () => {
    const reference = tracked([['probe', 0], ['b', 60], ['c', 60]]);
    const withSelf = likenessScores(new Map([['probe', at(0)]]), reference, 2);
    const withoutSelf = likenessScores(new Map([['probe', at(0)]]), reference.slice(1), 2);
    expect(withSelf.get('probe')).toBeCloseTo(0.5, 6);
    expect(withSelf.get('probe')).toBeCloseTo(withoutSelf.get('probe')!, 6);
  });

  it('averages over everything available when k exceeds the reference size', () => {
    const scores = likenessScores(new Map([['probe', at(0)]]), tracked([['a', 0], ['b', 60]]), 50);
    expect(scores.get('probe')).toBeCloseTo(0.75, 6);
  });

  // No reference set is not a score of zero — zero would read as "nothing like a tracked channel"
  // and get the channel filtered out. An absent entry tells the caller to keep the old value.
  it('returns no entry at all for an empty tracked set', () => {
    expect(likenessScores(new Map([['probe', at(0)]]), [], 5).size).toBe(0);
  });

  it('returns no entry for a channel that is the only thing in the tracked set', () => {
    expect(likenessScores(new Map([['probe', at(0)]]), tracked([['probe', 0]]), 5).size).toBe(0);
  });

  it('does not require unit-length input', () => {
    const scaled = likenessScores(new Map([['probe', [7, 0]]]), [{ channel_id: 'a', vector: [0, 3] }], 1);
    expect(scaled.get('probe')).toBeCloseTo(0, 6);
  });
});

describe('mergeLikenessPayload', () => {
  const payload = { channel_id: 'UC1', n_videos: 50 };

  it('writes the freshly computed value, rounded the way the batch script rounds', () => {
    expect(mergeLikenessPayload(payload, 0.7654321)).toEqual({ ...payload, creator_likeness: 0.7654 });
  });

  // The bug this exists for: a whole-point upsert replaces the payload, so a rebuild with no fresh
  // measurement must re-state the value the point already had rather than drop the field.
  it('carries the existing value forward when nothing was computed', () => {
    expect(mergeLikenessPayload(payload, undefined, { creator_likeness: 0.5123, channel_id: 'UC1' }))
      .toEqual({ ...payload, creator_likeness: 0.5123 });
  });

  it('prefers the computed value over the existing one', () => {
    expect(mergeLikenessPayload(payload, 0.9, { creator_likeness: 0.1 }).creator_likeness).toBe(0.9);
  });

  it('omits the field only when neither source exists', () => {
    expect(mergeLikenessPayload(payload, null, null)).toEqual(payload);
    expect(mergeLikenessPayload(payload, Number.NaN, { creator_likeness: 'nope' })).toEqual(payload);
  });
});
