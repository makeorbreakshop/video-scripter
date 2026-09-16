import { channelIdsOf, pendingPoints } from './catalog-sync';

const point = (id: string, hash: string, channelId?: string) => ({
  id, hash, payload: { channel_id: channelId ?? `ch-${id}` },
});

describe('pendingPoints', () => {
  it('keeps points whose stored hash differs or is missing', () => {
    const prepared = [point('a', 'h1'), point('b', 'h2'), point('c', 'h3')];
    const stored = new Map<string | undefined, string | undefined>([['a', 'h1'], ['b', 'old']]);
    expect(pendingPoints(prepared, stored).map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('returns nothing when every hash is current', () => {
    const prepared = [point('a', 'h1')];
    expect(pendingPoints(prepared, new Map([['a', 'h1']]))).toEqual([]);
  });
});

describe('channelIdsOf', () => {
  it('dedupes in first-seen order and drops blanks', () => {
    const points = [point('a', 'h', 'UC1'), point('b', 'h', 'UC2'), point('c', 'h', 'UC1'), point('d', 'h', '')];
    expect(channelIdsOf(points)).toEqual(['UC1', 'UC2']);
  });

  it('handles an empty list', () => {
    expect(channelIdsOf([])).toEqual([]);
  });
});
