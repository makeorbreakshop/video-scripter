#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Import tools after environment is loaded
const { explorePatternsTool } = await import('./dist/tools/explore-patterns.js');
const { findCrossNichePatternsTool } = await import('./dist/tools/find-cross-niche.js');
const { getPatternInsightsTool } = await import('./dist/tools/get-pattern-insights.js');

// Test result tracking
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const testResults = [];

// Helper function to run a test
async function runTest(name, testFn) {
  totalTests++;
  console.log(`\n🧪 Testing: ${name}`);
  console.log('-'.repeat(60));
  
  try {
    const startTime = Date.now();
    await testFn();
    const duration = Date.now() - startTime;
    
    passedTests++;
    console.log(`✅ PASSED (${duration}ms)`);
    testResults.push({ name, status: 'passed', duration });
  } catch (error) {
    failedTests++;
    console.error(`❌ FAILED: ${error.message}`);
    if (process.env.VERBOSE) {
      console.error(error.stack);
    }
    testResults.push({ name, status: 'failed', error: error.message });
  }
}

// Helper to validate response structure
function validateResponse(response, expectedFields) {
  const parsed = JSON.parse(response.content[0].text);
  
  for (const field of expectedFields) {
    const fieldParts = field.split('.');
    let current = parsed;
    
    for (const part of fieldParts) {
      if (!(part in current)) {
        throw new Error(`Missing expected field: ${field}`);
      }
      current = current[part];
    }
  }
  
  return parsed;
}

// Test 1: Basic explore_patterns functionality
async function testExplorePatterns() {
  const params = {
    core_concept: 'woodworking jigs',
    current_hook: 'saves hours of measuring',
    frame: 'Efficiency Through Smart Tools',
    exploration_depth: 2,
    min_performance: 1.5
  };
  
  const result = await explorePatternsTool(params);
  const response = validateResponse(result, [
    'query_context',
    'query_context.concept',
    'query_context.search_angles',
    'results',
    'results.title_searches',
    'results.summary_searches',
    'stats',
    'stats.total_videos_found'
  ]);
  
  if (response.stats.total_videos_found === 0) {
    throw new Error('No videos found - API may be down');
  }
  
  console.log(`  Found ${response.stats.total_videos_found} videos`);
  console.log(`  Unique videos: ${response.stats.unique_videos}`);
  console.log(`  Search angles used: ${response.stats.search_queries_used}`);
}

// Test 2: explore_patterns with channel_id
async function testExploreWithChannel() {
  const params = {
    core_concept: '3D printing fails',
    current_hook: 'expensive mistake that taught me',
    frame: 'Learning From Failures',
    channel_id: 'UC_7aK9PpYTqt08ERh1MewlQ', // Example channel
    exploration_depth: 1,
    min_performance: 2.0
  };
  
  const result = await explorePatternsTool(params);
  const response = validateResponse(result, [
    'results.channel_gaps'
  ]);
  
  console.log(`  Channel gaps found: ${response.results.channel_gaps?.length || 0}`);
}

// Test 3: Cross-niche pattern finding
async function testCrossNichePatterns() {
  const params = {
    psychological_trigger: 'transformation before and after',
    exclude_niches: ['fitness', 'weight-loss'],
    min_performance: 2.5,
    limit: 10
  };
  
  const result = await findCrossNichePatternsTool(params);
  const response = validateResponse(result, [
    'query_context',
    'results',
    'results.by_niche',
    'stats'
  ]);
  
  const nicheCount = Object.keys(response.results.by_niche).length;
  console.log(`  Found patterns across ${nicheCount} niches`);
  console.log(`  Total videos: ${response.stats.total_videos}`);
}

// Test 4: Pattern insights with video IDs
async function testPatternInsightsByID() {
  // First get some video IDs from a search
  const searchParams = {
    core_concept: 'DIY workshop organization',
    current_hook: 'tiny space big results',
    frame: 'Maximizing Limited Resources',
    exploration_depth: 1
  };
  
  const searchResult = await explorePatternsTool(searchParams);
  const searchResponse = JSON.parse(searchResult.content[0].text);
  
  if (searchResponse.results.title_searches.length < 2) {
    throw new Error('Not enough videos to test pattern insights');
  }
  
  // Get first 3 video IDs
  const videoIds = searchResponse.results.title_searches
    .slice(0, 3)
    .map(v => v.video_id);
  
  const params = {
    pattern_examples: videoIds,
    include_thumbnails: true
  };
  
  const result = await getPatternInsightsTool(params);
  const response = validateResponse(result, [
    'videos_analyzed',
    'pattern_examples',
    'channel_baselines',
    'common_tags',
    'performance_stats'
  ]);
  
  console.log(`  Analyzed ${response.videos_analyzed} videos`);
  console.log(`  Average TPS: ${response.performance_stats.avg_tps.toFixed(2)}`);
  console.log(`  Common tags found: ${response.common_tags.length}`);
}

// Test 5: Pattern insights with title search
async function testPatternInsightsByTitle() {
  const params = {
    pattern_examples: [
      '10 Mistakes Every Beginner Makes',
      'Why Your First Project Will Fail',
      'Common Errors to Avoid'
    ],
    include_thumbnails: false
  };
  
  const result = await getPatternInsightsTool(params);
  const response = validateResponse(result, [
    'videos_analyzed',
    'format_distribution',
    'niche_distribution'
  ]);
  
  console.log(`  Videos found by title: ${response.videos_analyzed}`);
  console.log(`  Format types: ${Object.keys(response.format_distribution).join(', ')}`);
}

// Test 6: Error handling - invalid parameters
async function testErrorHandling() {
  try {
    // Missing required field
    await explorePatternsTool({
      core_concept: 'test',
      // Missing current_hook and frame
    });
    throw new Error('Should have thrown error for missing parameters');
  } catch (error) {
    if (!error.message.includes('Should have thrown')) {
      console.log('  Correctly handled missing parameters');
      return;
    }
    throw error;
  }
}

// Test 7: Performance test - parallel execution
async function testParallelPerformance() {
  const startTime = Date.now();
  
  // Run 3 searches in parallel
  const promises = [
    explorePatternsTool({
      core_concept: 'laser engraving tips',
      current_hook: 'professional results at home',
      frame: 'Mastery Through Practice',
      exploration_depth: 1
    }),
    findCrossNichePatternsTool({
      psychological_trigger: 'quick wins',
      min_performance: 3.0,
      limit: 5
    }),
    getPatternInsightsTool({
      pattern_examples: ['qDy-1j5PcKU', 'BxV14h0kFs0'],
      include_thumbnails: false
    })
  ];
  
  await Promise.all(promises);
  const duration = Date.now() - startTime;
  
  console.log(`  Completed 3 parallel operations in ${duration}ms`);
  if (duration > 5000) {
    console.warn('  ⚠️ Performance warning: Operations took longer than expected');
  }
}

// Test 8: Search angle generation variety
async function testSearchAngleVariety() {
  const params = {
    core_concept: 'AI automation for small business',
    current_hook: 'replaced my virtual assistant',
    frame: 'Technology Over Human Labor',
    exploration_depth: 5  // Max depth to test all angles
  };
  
  const result = await explorePatternsTool(params);
  const response = JSON.parse(result.content[0].text);
  
  const angles = Object.keys(response.query_context.search_angles);
  console.log(`  Generated ${angles.length} search angles`);
  console.log(`  Angles: ${angles.slice(0, 5).join(', ')}...`);
  
  if (angles.length < 10) {
    throw new Error('Expected at least 10 search angles');
  }
}

// Test 9: Deduplication verification
async function testDeduplication() {
  const params = {
    core_concept: 'YouTube thumbnail design',
    current_hook: 'doubled my click rate',
    frame: 'Visual Psychology',
    exploration_depth: 3
  };
  
  const result = await explorePatternsTool(params);
  const response = JSON.parse(result.content[0].text);
  
  // Check for duplicates
  const allVideos = [
    ...response.results.title_searches,
    ...response.results.summary_searches
  ];
  
  const videoIds = allVideos.map(v => v.video_id);
  const uniqueIds = new Set(videoIds);
  
  console.log(`  Total results: ${allVideos.length}`);
  console.log(`  Unique videos: ${uniqueIds.size}`);
  console.log(`  Reported unique: ${response.stats.unique_videos}`);
  
  if (response.stats.unique_videos !== uniqueIds.size) {
    throw new Error('Unique video count mismatch');
  }
}

// Test 10: Minimum performance filtering
async function testPerformanceFiltering() {
  const highPerf = await explorePatternsTool({
    core_concept: 'viral video strategy',
    current_hook: 'got 1 million views',
    frame: 'Virality Mechanics',
    exploration_depth: 1,
    min_performance: 5.0  // Very high threshold
  });
  
  const highResponse = JSON.parse(highPerf.content[0].text);
  
  const lowPerf = await explorePatternsTool({
    core_concept: 'viral video strategy',
    current_hook: 'got 1 million views',
    frame: 'Virality Mechanics',
    exploration_depth: 1,
    min_performance: 1.0  // Low threshold
  });
  
  const lowResponse = JSON.parse(lowPerf.content[0].text);
  
  console.log(`  High threshold (5.0x): ${highResponse.stats.total_videos_found} videos`);
  console.log(`  Low threshold (1.0x): ${lowResponse.stats.total_videos_found} videos`);
  
  if (highResponse.stats.total_videos_found >= lowResponse.stats.total_videos_found) {
    throw new Error('High performance filter should return fewer results');
  }
}

// Main test runner
async function runAllTests() {
  console.log('=' .repeat(60));
  console.log('MCP Server Comprehensive Test Suite');
  console.log('=' .repeat(60));
  
  const tests = [
    ['Basic explore_patterns', testExplorePatterns],
    ['Explore with channel context', testExploreWithChannel],
    ['Cross-niche pattern finding', testCrossNichePatterns],
    ['Pattern insights by video ID', testPatternInsightsByID],
    ['Pattern insights by title', testPatternInsightsByTitle],
    ['Error handling', testErrorHandling],
    ['Parallel performance', testParallelPerformance],
    ['Search angle variety', testSearchAngleVariety],
    ['Deduplication verification', testDeduplication],
    ['Performance filtering', testPerformanceFiltering]
  ];
  
  for (const [name, testFn] of tests) {
    await runTest(name, testFn);
  }
  
  // Print summary
  console.log('\n' + '=' .repeat(60));
  console.log('TEST SUMMARY');
  console.log('=' .repeat(60));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`✅ Passed: ${passedTests}`);
  console.log(`❌ Failed: ${failedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  
  if (failedTests > 0) {
    console.log('\nFailed Tests:');
    testResults
      .filter(r => r.status === 'failed')
      .forEach(r => console.log(`  - ${r.name}: ${r.error}`));
  }
  
  // Performance summary
  const avgDuration = testResults
    .filter(r => r.duration)
    .reduce((sum, r) => sum + r.duration, 0) / passedTests;
  
  console.log(`\nAverage Test Duration: ${avgDuration.toFixed(0)}ms`);
  
  process.exit(failedTests > 0 ? 1 : 0);
}

// Handle arguments
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`
MCP Server Test Suite

Usage: node test-suite.js [options]

Options:
  --help      Show this help message
  --verbose   Show detailed error stack traces
  --single    Run a single test (specify test name)

Examples:
  node test-suite.js                    # Run all tests
  node test-suite.js --verbose          # Run with detailed output
  VERBOSE=1 node test-suite.js          # Alternative verbose mode
`);
  process.exit(0);
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal test error:', error);
  process.exit(1);
});