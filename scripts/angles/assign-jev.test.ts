import { describe, expect, it } from '@jest/globals';
import { buildQuestions, buildState, UNPACKAGED_KEY } from './assign-jev';
import { readTaxonomyV3 } from './taxonomy-v3';

const angles = readTaxonomyV3().angles;

describe('buildQuestions', () => {
  it('asks one noul per angle plus the unpackaged cross-check and two scores', () => {
    const q = buildQuestions(angles);
    expect(Object.keys(q)).toHaveLength(angles.length + 3);
    expect(q[UNPACKAGED_KEY].type).toBe('noul');
    expect(q.curiosity_gap.type).toBe('score');
  });

  it('passes each angle definition through as the noul instructions verbatim', () => {
    const q = buildQuestions(angles);
    for (const a of angles) expect(q[a.angle_id].instructions).toBe(a.definition);
  });

  it('gives both scores exactly four levels', () => {
    const q = buildQuestions(angles);
    expect((q.curiosity_gap as any).criteria).toHaveLength(4);
    expect((q.specificity as any).criteria).toHaveLength(4);
  });

  it('drops every angle for the cheap unpackaged-only second pass', () => {
    expect(Object.keys(buildQuestions(angles, { anglesOn: false }))).toEqual([UNPACKAGED_KEY]);
  });
});

describe('buildState', () => {
  it('leads with the title and collapses description whitespace', () => {
    const s = buildState({ id: 'x', title: 'A Title', description: 'one\n\n two   three', channel_name: 'Ch' });
    expect(s.split('\n')[0]).toBe('Title: A Title');
    expect(s).toContain('Description: one two three');
    expect(s).toContain('Channel: Ch');
  });

  it('says so rather than leaving a dangling label when there is no description', () => {
    expect(buildState({ id: 'x', title: 'T', description: null, channel_name: null }))
      .toBe('Title: T\nChannel: unknown\nDescription: (none)');
  });
});
