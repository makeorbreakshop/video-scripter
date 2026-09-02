import { parseSort, SORTS, GRID_PAGE } from './channel-page';

describe('parseSort', () => {
  it('defaults to newest-first, so an unscored channel still reads chronologically', () => {
    expect(parseSort(undefined)).toBe('published');
    expect(parseSort(null)).toBe('published');
    expect(parseSort('')).toBe('published');
    expect(parseSort('nonsense')).toBe('published');
  });
  it('honours the sorts the tabs offer', () => {
    expect(parseSort('score')).toBe('score');
    expect(parseSort('views')).toBe('views');
    expect(parseSort(['views'])).toBe('views');
  });
});

describe('SORTS', () => {
  it('puts unscored and undated rows last rather than treating them as zero', () => {
    for (const clause of Object.values(SORTS)) expect(clause).toMatch(/nulls last/);
  });
  it('never filters — an unscored video still belongs in the grid', () => {
    for (const clause of Object.values(SORTS)) expect(clause).not.toMatch(/where|is not null/i);
  });
});

it('pages enough rows that a normal channel fits in one screenful', () => {
  expect(GRID_PAGE).toBeGreaterThanOrEqual(60);
});
