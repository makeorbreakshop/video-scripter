#!/usr/bin/env node

import { searchOutlierPackagesTool } from './dist/tools/search-outlier-packages.js';

const result = await searchOutlierPackagesTool({
  search_intent: process.env.PACKAGE_SEARCH_INTENT || 'package_transfer',
  target: {
    title: "Best Laser Cutter 2026: Tested 47 Machines, Here's What to Buy",
    description: 'A category-level buyer guide based on experience across 47 machines. It helps a maker choose the right laser category and price level for the jobs and materials they actually need.',
    viewer_job: 'Avoid the wrong machine category and make a confident purchase for the work the viewer actually does.',
    available_evidence: [
      'Footage and experience with representative diode, desktop CO2, larger CO2, fiber, and galvo machines.',
      'The video can compare category differences, materials, jobs, setup, and price-to-capability tradeoffs.',
    ],
    hard_constraints: [
      'Only 47 and 2026 are established numbers.',
      'Do not invent exact prices, percentages, profit, wasted money, a controlled test, or a universal winner.',
      'Do not change the viewer job into a one-product review, business-income story, build, or challenge.',
    ],
  },
  package_hints: [
    'high-cost mistake',
    'hidden-inside reveal',
    'reputation reversal',
    'category collision',
    'contradiction between what people say and what the evidence shows',
  ],
  top_k: Number(process.env.PACKAGE_SEARCH_TOP_K || 5),
  candidate_pool_size: Number(process.env.PACKAGE_SEARCH_CANDIDATES || 8),
  max_cost_usd: Number(process.env.PACKAGE_SEARCH_COST_CAP || 0.012),
});

const response = JSON.parse(result.content[0].text);
console.log(JSON.stringify({
  requested_intent: response.requested_intent,
  receipt: response.receipt,
  results: response.results.map((item) => ({
    rank: item.rank,
    source_id: item.source.id,
    source_title: item.source.title,
    outlier_score: item.source.outlier.score,
    package_family: item.package_family,
    guard: item.guard,
    proposed_title: item.transfer?.proposed_title,
    proposed_thumbnail: item.transfer?.proposed_thumbnail,
  })),
  rejected_results: response.rejected_results?.map((item) => ({
    source_id: item.source.id,
    source_title: item.source.title,
    model_assessment: item.model_assessment,
    guard: item.guard,
    why_rejected: item.why_rejected,
  })),
}, null, 2));
