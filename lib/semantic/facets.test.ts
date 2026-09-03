import { facetPromptInput, parseFacetResult, SEMANTIC_FACET_PROMPT_VERSION } from './facets';

describe('semantic facet helpers', () => {
  test('keeps performance data out of prompt inputs', () => {
    const input = facetPromptInput({
      id: 'v1',
      title: 'Cheap engraver beats the expensive one',
      channelName: 'Laser Tests',
      description: '1,000,000 views. Affiliate link. The setup compares cut quality.',
      topicLabel: 'laser engraving',
    });

    expect(input.prompt_version).toBe(SEMANTIC_FACET_PROMPT_VERSION);
    expect(input.text).toContain('The setup compares cut quality.');
    expect(input.text).not.toMatch(/1,000,000|views|Affiliate/i);
  });

  test('validates terse facet JSON with mandatory abstraction fields', () => {
    const parsed = parseFacetResult({
      niche: 'laser engraving',
      purpose: 'compare a cheap tool with an expensive one',
      purpose_abstract: 'underdog beats incumbent on a measurable task',
      mechanism: 'side-by-side test',
      mechanism_abstract: 'head-to-head comparison with a stake',
      packaging_claim: 'claims comparable quality for less money',
      evidence_status: 'packaging_only',
      hook_device: 'price_reveal',
      format: 'comparison',
      confidence: 'medium',
    });

    expect(parsed.confidence).toBe('medium');
  });

  test('rejects facets without abstraction or with evidence leakage', () => {
    expect(() => parseFacetResult({
      purpose: 'x',
      mechanism: 'y',
      evidence_status: 'verified',
      confidence: 'medium',
    })).toThrow(/purpose_abstract|evidence_status/i);
  });
});
