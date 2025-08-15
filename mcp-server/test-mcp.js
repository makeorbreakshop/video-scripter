#!/usr/bin/env node

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Now import after environment is loaded
const { explorePatternsTool } = await import('./dist/tools/explore-patterns.js');

async function testExplorePatterns() {
  console.log('🧪 Testing explore_patterns tool...\n');
  
  const testParams = {
    core_concept: 'AI tools for laser engraving business',
    current_hook: 'customer sent terrible photo but I could fix it with AI',
    frame: 'Strategic Tool Mastery Over Skill Building',
    exploration_depth: 3,
    min_performance: 1.5
  };
  
  console.log('Input parameters:', testParams);
  console.log('\n---\n');
  
  try {
    const result = await explorePatternsTool(testParams);
    
    // Parse the JSON response
    const response = JSON.parse(result.content[0].text);
    
    console.log('✅ Tool executed successfully!\n');
    console.log('Query Context:');
    console.log(`  - Concept: ${response.query_context.concept}`);
    console.log(`  - Hook: ${response.query_context.hook}`);
    console.log(`  - Frame: ${response.query_context.frame}`);
    console.log(`  - Search angles generated: ${Object.keys(response.query_context.search_angles).length}`);
    
    console.log('\nResults Summary:');
    console.log(`  - Title searches: ${response.results.title_searches.length} videos`);
    console.log(`  - Summary searches: ${response.results.summary_searches.length} videos`);
    console.log(`  - Cross-niche searches: ${response.results.cross_niche_searches.length} videos`);
    console.log(`  - High performers: ${response.results.high_performers.length} videos`);
    
    console.log('\nStats:');
    console.log(`  - Total videos found: ${response.stats.total_videos_found}`);
    console.log(`  - Unique videos: ${response.stats.unique_videos}`);
    console.log(`  - Average performance: ${response.stats.avg_performance.toFixed(2)}x baseline`);
    console.log(`  - Search queries used: ${response.stats.search_queries_used}`);
    
    // Show a few example results
    if (response.results.title_searches.length > 0) {
      console.log('\nExample Title Search Results:');
      response.results.title_searches.slice(0, 3).forEach((video, i) => {
        console.log(`  ${i + 1}. "${video.title}"`);
        console.log(`     Channel: ${video.channel_name}`);
        const perfScore = video.temporal_performance_score || video.performance_ratio || 0;
        console.log(`     Performance: ${typeof perfScore === 'number' ? perfScore.toFixed(2) : perfScore}x`);
        console.log(`     Views: ${video.view_count.toLocaleString()}`);
      });
    }
    
    if (response.results.cross_niche_searches.length > 0) {
      console.log('\nExample Cross-Niche Results:');
      response.results.cross_niche_searches.slice(0, 3).forEach((video, i) => {
        console.log(`  ${i + 1}. "${video.title}"`);
        console.log(`     Niche: ${video.topic_niche || 'uncategorized'}`);
        const perfScore = video.temporal_performance_score || video.performance_ratio || 0;
        console.log(`     Performance: ${typeof perfScore === 'number' ? perfScore.toFixed(2) : perfScore}x`);
      });
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
console.log('='.repeat(60));
console.log('Video Scripter MCP Server Test');
console.log('='.repeat(60));
console.log();

testExplorePatterns().then(() => {
  console.log('\n' + '='.repeat(60));
  console.log('✅ All tests passed!');
  console.log('='.repeat(60));
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});