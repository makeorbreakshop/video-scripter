import { Bm25Index, tokenizeForBm25 } from './bm25';

describe('semantic BM25 baseline', () => {
  test('normalizes case and punctuation into stable Unicode word tokens', () => {
    expect(tokenizeForBm25('Laser-Engraver: LASER jigs!')).toEqual(['laser', 'engraver', 'laser', 'jigs']);
  });

  test('ranks matching documents and breaks score ties by stable id', () => {
    const index = new Bm25Index([
      { id: 'b', text: 'laser engraver review' },
      { id: 'a', text: 'laser engraver review' },
      { id: 'c', text: 'air fryer recipes' },
    ]);

    expect(index.search('laser engraver', 10).map((row) => row.id)).toEqual(['a', 'b']);
    expect(index.search('laser engraver', 1)).toHaveLength(1);
    expect(index.search('unknown term', 10)).toEqual([]);
  });

  test('supports explicit exact-match boosts without changing the corpus text', () => {
    const index = new Bm25Index([
      { id: 'exact', text: 'Make or Break Shop' },
      { id: 'verbose', text: 'Make or Break Shop fan review and workshop tour' },
    ]);

    expect(index.search('Make or Break Shop', 10, { boosts: new Map([['exact', 1_000]]) })[0].id)
      .toBe('exact');
  });

  test('rejects duplicate document ids', () => {
    expect(() => new Bm25Index([{ id: 'same', text: 'one' }, { id: 'same', text: 'two' }]))
      .toThrow(/duplicate/i);
  });
});
