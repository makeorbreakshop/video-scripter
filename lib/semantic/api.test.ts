import { channelMatchEvidence, diversifyByChannel, lexicalMatchEvidence } from './api';

describe('agent-facing semantic evidence', () => {
  test('returns bounded semantic fields and only matching niches', () => {
    expect(channelMatchEvidence('laser engraving reviews', [
      'Laser Engraving', 'Woodworking', 'Product Reviews', 'Fourth', 'Fifth',
    ])).toEqual({
      semantic_fields: ['top_titles', 'top_niches'],
      lexical_fields: [],
      matched_niches: ['Laser Engraving', 'Product Reviews'],
    });
  });

  test('identifies lexical name and handle evidence without returning source documents', () => {
    expect(lexicalMatchEvidence('make stuff', 'I Like To Make Stuff', 'ilikemakestuff', ['Laser']))
      .toEqual({ semantic_fields: [], lexical_fields: ['name', 'handle'], matched_niches: ['Laser'] });
  });
});

describe('topical diversity', () => {
  test('caps results per channel while preserving rank order and allows zero to disable', () => {
    const rows = [
      { id: '1', channel_id: 'a' }, { id: '2', channel_id: 'a' },
      { id: '3', channel_id: 'b' }, { id: '4', channel_id: 'c' },
    ];
    expect(diversifyByChannel(rows, 1, 3).map((row) => row.id)).toEqual(['1', '3', '4']);
    expect(diversifyByChannel(rows, 0, 4)).toEqual(rows);
  });
});
