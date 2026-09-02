import { normalizeName, searchTerms, handleFromInput } from './channel-search';

describe('normalizeName', () => {
  it('collapses to lowercase alphanumerics so "I Like To Make Stuff" == "iliketomakestuff"', () => {
    expect(normalizeName('I Like To Make Stuff')).toBe('iliketomakestuff');
    expect(normalizeName('  John  Malecki ')).toBe('johnmalecki');
    expect(normalizeName('@John_Malecki')).toBe('johnmalecki');
    expect(normalizeName('Allrecipes!')).toBe('allrecipes');
  });
  it('is empty for nothing usable', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName('@@ --')).toBe('');
  });
});

describe('handleFromInput', () => {
  it('reads a bare or url handle, lowercased without the @', () => {
    expect(handleFromInput('@iliketomakestuff')).toBe('iliketomakestuff');
    expect(handleFromInput('@John_Malecki')).toBe('john_malecki');
    expect(handleFromInput('https://youtube.com/@Iliketomakestuff')).toBe('iliketomakestuff');
  });
  it('is null for free text', () => {
    expect(handleFromInput('i like to make stuff')).toBeNull();
  });
});

describe('searchTerms', () => {
  it('builds the three views of the query the SQL ranks on', () => {
    expect(searchTerms('  I like to Make Stuff ')).toEqual({
      text: 'i like to make stuff',
      norm: 'iliketomakestuff',
      handle: null,
    });
  });
  it('treats an @handle as a handle and as a name', () => {
    expect(searchTerms('@ilikemakestuff')).toEqual({
      text: 'ilikemakestuff',
      norm: 'ilikemakestuff',
      handle: 'ilikemakestuff',
    });
  });
  it('is null when there is nothing to search', () => {
    expect(searchTerms(' ')).toBeNull();
    expect(searchTerms('a')).toBeNull();
  });
});
