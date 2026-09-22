import { describe, expect, it } from '@jest/globals';
import { readTaxonomyV3, validateTaxonomy, TaxonomyV3 } from './taxonomy-v3';

const ok = (over: Partial<TaxonomyV3> = {}): TaxonomyV3 => ({
  families: [{ family_id: 'f', family_label: 'F', family_definition: 'd', surface: 'title' }],
  angles: [{
    angle_id: 'a_one', family_id: 'f', angle_label: 'A one', source: 'enum',
    definition: 'Does the title frame the subject as X?',
    criteria: { true: 't', false: 'f' },
  }],
  ...over,
});

describe('validateTaxonomy', () => {
  it('accepts a well-formed taxonomy', () => {
    expect(validateTaxonomy(ok())).toEqual([]);
  });

  it('rejects a definition that is not a question, because it becomes the noul instructions', () => {
    const t = ok();
    t.angles[0].definition = 'Frames the subject as X.';
    expect(validateTaxonomy(t)).toContain('a_one: definition is not a question');
  });

  it('rejects an unknown family', () => {
    const t = ok();
    t.angles[0].family_id = 'nope';
    expect(validateTaxonomy(t)).toContain('a_one: unknown family nope');
  });

  it('rejects a duplicate angle_id, which would silently drop a question', () => {
    const t = ok();
    t.angles.push({ ...t.angles[0] });
    expect(validateTaxonomy(t)).toContain('duplicate angle_id a_one');
  });

  it('rejects an id that collides with a reserved question key', () => {
    const t = ok();
    t.angles[0].angle_id = 'unpackaged';
    expect(validateTaxonomy(t)).toContain('angle_id collides with the reserved key "unpackaged"');
  });

  it('rejects a label longer than five words', () => {
    const t = ok();
    t.angles[0].angle_label = 'one two three four five six';
    expect(validateTaxonomy(t)).toContain('a_one: label over 5 words');
  });

  it('rejects an id that is not snake_case', () => {
    const t = ok();
    t.angles[0].angle_id = 'AOne';
    expect(validateTaxonomy(t)).toContain('angle_id not snake_case: AOne');
  });
});

describe('the checked-in library', () => {
  it('loads and validates', () => {
    const t = readTaxonomyV3();
    expect(t.angles.length).toBeGreaterThanOrEqual(35);
    expect(t.angles.length).toBeLessThanOrEqual(45);
  });

  it('every angle is title-surface, because thumbnail composition is a different axis', () => {
    const t = readTaxonomyV3();
    expect(t.families.every((f) => f.surface === 'title')).toBe(true);
  });

  it('keeps both sources represented', () => {
    const sources = new Set(readTaxonomyV3().angles.map((a) => a.source));
    expect(sources).toEqual(new Set(['enum', 'emergent', 'merged']));
  });
});
