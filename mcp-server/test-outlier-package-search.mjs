#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  applyTransferGuard,
  parseSearchOutlierPackagesParams,
  runOutlierPackageSearch,
  searchOutlierPackagesDefinition,
  selectCrossTopicCandidatePool,
} from './dist/tools/search-outlier-packages.js';

const target = {
  title: "Best Laser Cutter 2026: Tested 47 Machines, Here's What to Buy",
  description: 'A category-level guide to choosing the right laser for the jobs and materials a viewer needs.',
  thumbnail_url: 'https://i.ytimg.com/vi/target12345/hqdefault.jpg',
  hard_constraints: [
    'Only the numbers 47 and 2026 are established.',
    'Do not invent exact prices, percentages, profit, wasted money, a controlled test, or a universal winner.',
  ],
};

function candidate(overrides = {}) {
  return {
    id: 'source00001',
    title: 'I Investigated the Cheapest Hotel in New York',
    description: 'A first-person investigation into what the low price hides.',
    thumbnail_url: 'https://i.ytimg.com/vi/source00001/hqdefault.jpg',
    channel_id: 'channel-1',
    channel_name: 'Source Channel',
    published_at: 1_788_000_000,
    score: 4,
    n_baseline: 20,
    confidence: 'confirmed',
    score_model_version: 'v5.4',
    baseline: 10_000,
    ...overrides,
  };
}

function modelResult(id, overrides = {}) {
  return {
    id,
    package_family: 'investigation',
    viewer_promise: 'Reveal what a suspiciously cheap option is hiding.',
    title_mechanism: 'First-person investigation plus a withheld answer.',
    thumbnail_grammar: 'One hero object, skeptical face, and a single price cue.',
    source_title_thumbnail_relationship: 'completes',
    source_opening_expectation: 'Open on the suspicious evidence, then begin the investigation.',
    transfer_fit: 'strong_candidate',
    preserved_invariants: ['investigation', 'withheld answer', 'visual evidence'],
    ported_title: 'I Investigated the Cheapest Laser in 2026',
    ported_thumbnail: 'One small laser isolated beside the larger machines; skeptical presenter; no added claim.',
    ported_opening: 'Show what makes the cheap machine suspicious, then test where it fits.',
    why_transfer: 'The guide can truthfully investigate a low-end category while preserving the viewer job.',
    evidence_required: [],
    risk_flags: [],
    ...overrides,
  };
}

assert.equal(searchOutlierPackagesDefinition.name, 'search_outlier_packages');
assert.deepEqual(
  searchOutlierPackagesDefinition.inputSchema.properties.search_intent.enum,
  ['topic', 'package_transfer'],
);

assert.throws(
  () => parseSearchOutlierPackagesParams({ search_intent: 'same_words', target }),
  /search_intent/,
);
assert.equal(
  parseSearchOutlierPackagesParams({ search_intent: 'package_transfer', target }).candidate_pool_size,
  12,
);

const selectionCandidates = [
  candidate({ id: 'near0000001', channel_id: 'near-channel' }),
  candidate({ id: 'warning0001', channel_id: 'a', title: "Don't Buy a Domain Until You Watch This!", score: 7 }),
  candidate({ id: 'reveal00001', channel_id: 'b', title: "What's Inside These Lake Superior Agates?", score: 6 }),
  candidate({ id: 'repeat00001', channel_id: 'a', title: 'I Investigated Another Hotel', score: 3 }),
  candidate({ id: 'weak0000001', channel_id: 'c', score: 1.8 }),
];
const selectionSnapshot = structuredClone(selectionCandidates);
const selected = selectCrossTopicCandidatePool(selectionCandidates, new Set(['near0000001']), undefined, 3);
assert.deepEqual(selected.map((row) => row.id).sort(), ['reveal00001', 'warning0001']);
assert.equal(new Set(selected.map((row) => row.package_family)).size, 2);
assert.deepEqual(selectionCandidates, selectionSnapshot);
assert.deepEqual(
  selectCrossTopicCandidatePool([...selectionCandidates].reverse(), new Set(['near0000001']), undefined, 3)
    .map((row) => row.id),
  selected.map((row) => row.id),
);
assert.deepEqual(
  selectCrossTopicCandidatePool(selectionCandidates, new Set(['near0000001']), undefined, 3, 5_000, 6.5)
    .map((row) => row.id),
  ['warning0001'],
);

const guarded = applyTransferGuard(target, modelResult('source00001', {
  ported_title: 'The Laser Mistake 90% of Buyers Make',
}));
assert.equal(guarded.guard.status, 'needs_revision');
assert.ok(guarded.guard.issues.includes('unsupported_number:90'));

const guardedStoryDrift = applyTransferGuard(target, modelResult('source00001', {
  ported_title: 'A Hidden Danger Is Wasting Thousands',
  ported_thumbnail: 'SAFETY ALERT beside one laser.',
  risk_flags: ['generic_noun_swap'],
}));
assert.equal(guardedStoryDrift.guard.status, 'rejected');
assert.ok(guardedStoryDrift.guard.issues.includes('forbidden_money_loss'));
assert.ok(guardedStoryDrift.guard.issues.includes('unsupported_safety_claim'));
assert.ok(guardedStoryDrift.guard.issues.includes('model_risk:generic_noun_swap'));

let packageAnalyzeCalls = 0;
let shortlistCalls = 0;
const packageDeps = {
  embed: async (text) => {
    assert.match(text, /Best Laser Cutter/);
    assert.match(text, /category-level guide/);
    return { vector: [1, 0], token_count: 30, estimated_cost_usd: 0.000001 };
  },
  semanticSearch: async () => [{ ...candidate({ id: 'near0000001' }), similarity: 0.91 }],
  scanOutliers: async () => [
    candidate({ id: 'near0000001', channel_id: 'near-channel' }),
    candidate({ id: 'cross000001', channel_id: 'cross-channel' }),
  ],
  shortlistCandidates: async (input) => {
    shortlistCalls += 1;
    assert.equal(input.target.title, target.title);
    assert.deepEqual(input.package_hints, ['hidden reveal']);
    assert.equal(input.candidates[0].description, 'A first-person investigation into what the low price hides.');
    return {
      results: [{ id: 'cross000001', reason: 'The investigation story can preserve the target viewer job.' }],
      model: 'gemini-3.1-flash-lite',
      usage: { promptTokenCount: 50, candidatesTokenCount: 20 },
      estimated_cost_usd: 0.00005,
    };
  },
  loadImage: async (url) => ({ mime_type: 'image/jpeg', data: Buffer.from(url).toString('base64') }),
  analyzeBatch: async (input) => {
    packageAnalyzeCalls += 1;
    assert.equal(input.target.title, target.title);
    assert.ok(input.target_image);
    assert.equal(input.candidates[0].title, 'I Investigated the Cheapest Hotel in New York');
    assert.equal(input.candidates[0].description, 'A first-person investigation into what the low price hides.');
    assert.ok(input.candidates[0].image.data);
    return {
      results: [modelResult(input.candidates[0].id)],
      model: 'gemini-3.1-flash-lite',
      usage: { promptTokenCount: 100, candidatesTokenCount: 100 },
      estimated_cost_usd: 0.0002,
    };
  },
  corpus: { collection: 'test-outliers', version: 'test-v1' },
};

const packageResponse = await runOutlierPackageSearch({
  search_intent: 'package_transfer',
  target,
  package_hints: ['hidden reveal'],
  top_k: 1,
  candidate_pool_size: 1,
}, packageDeps);
assert.equal(packageAnalyzeCalls, 1);
assert.equal(shortlistCalls, 1);
assert.equal(packageResponse.requested_intent, 'package_transfer');
assert.equal(packageResponse.results[0].source.id, 'cross000001');
assert.deepEqual(packageResponse.results[0].analysis_basis, ['title', 'description', 'thumbnail']);
assert.equal(packageResponse.receipt.semantic_role, 'negative_topic_filter');
assert.equal(packageResponse.receipt.gemini_calls, 2);
assert.match(packageResponse.results[0].shortlist_reason, /investigation story/);

let topicAnalyzeCalls = 0;
const topicResponse = await runOutlierPackageSearch({
  search_intent: 'topic',
  target,
  top_k: 1,
}, {
  ...packageDeps,
  semanticSearch: async () => [
    { ...candidate({ id: 'topic000001', title: 'The Best Laser Cutter for a Small Shop' }), similarity: 0.86 },
  ],
  scanOutliers: async () => { throw new Error('topic mode must not scan the corpus'); },
  shortlistCandidates: async () => { throw new Error('topic mode must not call Gemini'); },
  analyzeBatch: async () => { topicAnalyzeCalls += 1; throw new Error('topic mode must not call Gemini'); },
});
assert.equal(topicAnalyzeCalls, 0);
assert.equal(topicResponse.requested_intent, 'topic');
assert.equal(topicResponse.results[0].source.id, 'topic000001');
assert.equal(topicResponse.receipt.semantic_role, 'positive_topic_retrieval');
assert.equal(topicResponse.receipt.gemini_calls, 0);

console.log('search_outlier_packages focused tests passed');
