import { buildFacetSourceText, cleanDescriptionForRetrieval, sourceHash } from './text';

describe('semantic retrieval text helpers', () => {
  test('removes URLs, affiliate disclosures, hashtags and repetitive whitespace', () => {
    expect(cleanDescriptionForRetrieval(`
      Check this out https://example.com?a=1
      As an Amazon Associate I earn from qualifying purchases.
      #laser #tools
      Real sentence about diode engravers.
    `)).toBe('Check this out Real sentence about diode engravers.');
  });

  test('builds facet source text without performance leakage', () => {
    const text = buildFacetSourceText({
      title: 'Cheap laser beats Glowforge?',
      channelName: 'Shop Tests',
      description: 'Views: 1,000,000. Use code BRANDON. Actual test setup.',
      topicLabel: 'laser engraving',
    });

    expect(text).toContain('Cheap laser beats Glowforge?');
    expect(text).toContain('laser engraving');
    expect(text).toContain('Actual test setup.');
    expect(text).not.toMatch(/1,000,000|views/i);
  });

  test('hashes source text deterministically for re-extraction', () => {
    expect(sourceHash('a')).toBe(sourceHash('a'));
    expect(sourceHash('a')).not.toBe(sourceHash('b'));
  });

  test('does not split a Unicode surrogate pair at the description limit', () => {
    const cleaned = cleanDescriptionForRetrieval(`${'a'.repeat(9)}🎧`, 10);

    expect(cleaned).toBe('a'.repeat(9));
    expect(cleaned).not.toMatch(/[\uD800-\uDFFF]$/u);
  });
});
