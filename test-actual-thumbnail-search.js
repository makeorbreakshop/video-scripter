#!/usr/bin/env node

/**
 * Test thumbnail search with the populated index
 * Now that we know there are 246K vectors!
 */

import { pineconeThumbnailService } from './lib/pinecone-thumbnail-service.ts';
import { generateVisualQueryEmbedding } from './lib/thumbnail-embeddings.ts';

async function main() {
  console.log('🔍 THUMBNAIL SEARCH TEST (WITH 246K VECTORS)');
  console.log('='.repeat(50));
  
  try {
    // Test visual queries with different thresholds
    const testQuery = "person pointing at something in thumbnail";
    console.log(`🎯 Test query: "${testQuery}"`);
    
    console.log('\n🔄 Generating CLIP embedding for visual search...');
    const queryEmbedding = await generateVisualQueryEmbedding(testQuery);
    console.log(`✅ Generated ${queryEmbedding.length}D embedding`);
    
    // Test different similarity thresholds
    const thresholds = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    
    console.log('\n📊 TESTING SIMILARITY THRESHOLDS:');
    console.log('-'.repeat(50));
    
    for (const threshold of thresholds) {
      try {
        console.log(`\n🎯 Threshold: ${threshold}`);
        const startTime = Date.now();
        
        const results = await pineconeThumbnailService.searchSimilarThumbnails(
          queryEmbedding,
          20, // limit
          threshold
        );
        
        const duration = Date.now() - startTime;
        
        console.log(`   └── Results: ${results.results.length} (${duration}ms)`);
        console.log(`   └── Total available: ${results.totalAvailable}`);
        console.log(`   └── Has more: ${results.hasMore}`);
        
        if (results.results.length > 0) {
          const scores = results.results.map(r => r.similarity_score);
          const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
          const minScore = Math.min(...scores);
          const maxScore = Math.max(...scores);
          
          console.log(`   └── Score range: ${minScore.toFixed(3)} - ${maxScore.toFixed(3)} (avg: ${avgScore.toFixed(3)})`);
          
          // Show top 3 results
          console.log(`   └── Top matches:`);
          for (let i = 0; i < Math.min(3, results.results.length); i++) {
            const result = results.results[i];
            console.log(`       ${i+1}. ${result.title.slice(0, 50)}... (${result.similarity_score.toFixed(3)})`);
          }
        } else {
          console.log(`   └── ❌ No results found`);
        }
        
      } catch (error) {
        console.log(`   └── ❌ Error: ${error.message}`);
      }
    }
    
    console.log('\n🎯 RECOMMENDATIONS FOR PATTERN ANALYSIS:');
    console.log('='.repeat(50));
    console.log('Based on actual search results:');
    console.log('• Use threshold 0.3 for broader visual discovery');
    console.log('• Use threshold 0.5 for balanced quality/quantity');  
    console.log('• Use threshold 0.7 for high-confidence matches only');
    
    // Test a few more visual concepts
    const additionalQueries = [
      "shocked face expression",
      "bright colorful gaming setup",
      "tutorial with arrows"
    ];
    
    console.log('\n🧪 TESTING ADDITIONAL VISUAL CONCEPTS:');
    console.log('-'.repeat(50));
    
    for (const query of additionalQueries) {
      try {
        console.log(`\n🔄 Query: "${query}"`);
        const embedding = await generateVisualQueryEmbedding(query);
        
        const results = await pineconeThumbnailService.searchSimilarThumbnails(
          embedding,
          5, // just top 5
          0.3 // use recommended threshold
        );
        
        console.log(`   └── Results: ${results.results.length}`);
        if (results.results.length > 0) {
          const topScore = results.results[0].similarity_score;
          console.log(`   └── Best match: "${results.results[0].title.slice(0, 40)}..." (${topScore.toFixed(3)})`);
        }
        
      } catch (error) {
        console.log(`   └── ❌ Error: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}