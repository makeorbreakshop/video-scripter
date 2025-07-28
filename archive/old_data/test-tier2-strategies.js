// Test runner for Tier 2 expansion strategies
const fs = require('fs');

const TEST_CONCEPTS = [
  "React hooks tutorial",      // Technical
  "pottery wheel",             // Creative  
  "meal prep containers"       // Lifestyle
];

const STRATEGIES = [
  "progressiveTopicExpansion",
  "categoricalHierarchyExpansion", 
  "purposeBasedExpansion",
  "audienceInterestExpansion",
  "industryVerticalExpansion"
];

const MODEL = "gpt-4o-mini"; // Start with cheapest
const TEMPERATURE = 0.7;

async function runTest(concept, strategy) {
  try {
    const response = await fetch('http://localhost:3000/api/test-thread-expansion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concept,
        prompt: `{concept}`, // Will be replaced by the actual prompt
        model: MODEL,
        temperature: TEMPERATURE,
        strategy // We'll need to load the actual prompt
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.error(`Error for ${concept} - ${strategy}:`, data.error);
      return null;
    }

    // Extract key metrics
    const evaluation = data.evaluation || {};
    const topicDistance = evaluation.topicDistance || {};
    const totalQueries = Object.values(topicDistance).reduce((a, b) => a + b, 0);
    
    return {
      concept,
      strategy,
      overallScore: evaluation.overallScore || 0,
      sweetSpotPercentage: totalQueries > 0 ? (topicDistance.level3_sweetSpot / totalQueries * 100) : 0,
      categoryCount: evaluation.categoryCount || 0,
      semanticDiversity: evaluation.semanticDiversity || 0,
      estimatedVideoPool: evaluation.estimatedVideoPool || 0,
      progressiveWidening: evaluation.expansionQuality?.progressiveWidening || false,
      maintainsRelevance: evaluation.expansionQuality?.maintainsRelevance || false,
      cost: data.cost?.total || 0,
      timeMs: data.timeMs || 0,
      threads: data.threads || []
    };
  } catch (error) {
    console.error(`Network error for ${concept} - ${strategy}:`, error.message);
    return null;
  }
}

async function runAllTests() {
  console.log('Starting Tier 2 Strategy Tests...\n');
  const results = [];

  for (const concept of TEST_CONCEPTS) {
    console.log(`\nTesting concept: "${concept}"`);
    
    for (const strategy of STRATEGIES) {
      console.log(`  - Testing ${strategy}...`);
      const result = await runTest(concept, strategy);
      
      if (result) {
        results.push(result);
        console.log(`    ✓ Score: ${result.overallScore}/100, Sweet Spot: ${result.sweetSpotPercentage.toFixed(1)}%`);
      } else {
        console.log(`    ✗ Failed`);
      }
      
      // Wait a bit between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Analyze results
  console.log('\n=== RESULTS SUMMARY ===\n');
  
  // Group by strategy
  const strategyScores = {};
  STRATEGIES.forEach(strategy => {
    const strategyResults = results.filter(r => r.strategy === strategy);
    if (strategyResults.length > 0) {
      strategyScores[strategy] = {
        avgScore: strategyResults.reduce((sum, r) => sum + r.overallScore, 0) / strategyResults.length,
        avgSweetSpot: strategyResults.reduce((sum, r) => sum + r.sweetSpotPercentage, 0) / strategyResults.length,
        avgCategories: strategyResults.reduce((sum, r) => sum + r.categoryCount, 0) / strategyResults.length,
        avgDiversity: strategyResults.reduce((sum, r) => sum + r.semanticDiversity, 0) / strategyResults.length,
        totalCost: strategyResults.reduce((sum, r) => sum + r.cost, 0),
        results: strategyResults
      };
    }
  });

  // Print strategy comparison
  console.log('Strategy Performance (averaged across all concepts):');
  console.log('═══════════════════════════════════════════════════');
  
  Object.entries(strategyScores)
    .sort(([,a], [,b]) => b.avgScore - a.avgScore)
    .forEach(([strategy, stats]) => {
      console.log(`\n${strategy}:`);
      console.log(`  Overall Score: ${stats.avgScore.toFixed(1)}/100`);
      console.log(`  Sweet Spot %: ${stats.avgSweetSpot.toFixed(1)}%`);
      console.log(`  Categories: ${stats.avgCategories.toFixed(1)}`);
      console.log(`  Diversity: ${stats.avgDiversity.toFixed(2)}`);
      console.log(`  Total Cost: $${stats.totalCost.toFixed(4)}`);
    });

  // Save detailed results
  fs.writeFileSync(
    'tier2-test-results.json',
    JSON.stringify({ 
      testDate: new Date().toISOString(),
      model: MODEL,
      results,
      strategyScores 
    }, null, 2)
  );
  
  console.log('\n\nDetailed results saved to tier2-test-results.json');
}

// Note: This won't work directly because we need to integrate with the actual prompts
console.log('This test runner needs to be integrated with the Next.js app to access the prompts.');
console.log('Please run the tests manually through the UI and I\'ll analyze the results.');