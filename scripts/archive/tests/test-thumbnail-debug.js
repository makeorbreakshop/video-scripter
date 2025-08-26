#!/usr/bin/env node

/**
 * Debug thumbnail embeddings and search functionality
 * Tests the entire pipeline to identify issues
 */

import { pineconeThumbnailService } from './lib/pinecone-thumbnail-service.ts';
import { generateVisualQueryEmbedding, generateThumbnailEmbedding } from './lib/thumbnail-embeddings.ts';
import { config } from 'dotenv';

config();

async function main() {
  console.log('🔍 THUMBNAIL EMBEDDING DEBUG TEST');
  console.log('=' * 50);
  
  try {
    // 1. Check thumbnail index stats
    console.log('\n1️⃣ CHECKING THUMBNAIL INDEX STATUS');
    console.log('-'.repeat(40));
    
    const stats = await pineconeThumbnailService.getThumbnailIndexStats();
    console.log('📊 Thumbnail Index Stats:');
    console.log(`   └── Total vectors: ${stats.totalVectorCount}`);
    console.log(`   └── Dimensions: ${stats.dimension}`);
    console.log(`   └── Index fullness: ${(stats.indexFullness * 100).toFixed(2)}%`);
    console.log(`   └── Namespaces: ${Object.keys(stats.namespaces || {}).length}`);
    
    if (!stats.totalVectorCount || stats.totalVectorCount === 0) {
      console.log('❌ PROBLEM: Thumbnail index is empty! No vectors found.');
      return;
    }
    
    // 2. Test CLIP text-to-visual embedding generation
    console.log('\n2️⃣ TESTING CLIP TEXT-TO-VISUAL EMBEDDINGS');
    console.log('-'.repeat(40));
    
    const testQueries = [
      'a person pointing at something',
      'bright colorful thumbnail with text overlay',
      'shocked face expression',
      'gaming setup with monitor',
      'cooking food in kitchen'
    ];
    
    const embeddings = [];
    for (const query of testQueries) {
      try {
        console.log(`🔄 Testing: "${query}"`);
        const embedding = await generateVisualQueryEmbedding(query);
        embeddings.push({ query, embedding, dimensions: embedding.length });
        console.log(`   ✅ Generated ${embedding.length}D embedding`);
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
      }
    }
    
    // 3. Test thumbnail similarity search with various thresholds
    console.log('\n3️⃣ TESTING SIMILARITY SEARCH WITH DIFFERENT THRESHOLDS');
    console.log('-'.repeat(40));
    
    if (embeddings.length > 0) {
      const testEmbedding = embeddings[0].embedding;
      const testQuery = embeddings[0].query;
      console.log(`🎯 Using test query: "${testQuery}"`);
      
      const thresholds = [0.1, 0.3, 0.5, 0.7, 0.9];
      
      for (const threshold of thresholds) {
        try {
          console.log(`\n🔍 Testing threshold: ${threshold}`);
          const results = await pineconeThumbnailService.searchSimilarThumbnails(
            testEmbedding,
            10, // limit
            threshold
          );
          
          console.log(`   └── Results: ${results.results.length}/${results.totalAvailable}`);
          console.log(`   └── Has more: ${results.hasMore}`);
          
          if (results.results.length > 0) {
            const scores = results.results.map(r => r.similarity_score);
            const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
            const minScore = Math.min(...scores);
            const maxScore = Math.max(...scores);
            
            console.log(`   └── Score range: ${minScore.toFixed(3)} - ${maxScore.toFixed(3)} (avg: ${avgScore.toFixed(3)})`);
            console.log(`   └── Top result: "${results.results[0].title.slice(0, 50)}..."`);
          }
        } catch (error) {
          console.log(`   ❌ Search failed: ${error.message}`);
        }
      }
    }
    
    // 4. Test actual thumbnail embedding generation
    console.log('\n4️⃣ TESTING THUMBNAIL EMBEDDING GENERATION');
    console.log('-'.repeat(40));
    
    const testThumbnailUrl = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
    try {
      console.log(`🖼️ Testing thumbnail: ${testThumbnailUrl}`);
      const thumbnailEmbedding = await generateThumbnailEmbedding(testThumbnailUrl);
      console.log(`✅ Generated thumbnail embedding: ${thumbnailEmbedding.length}D`);
      
      // Compare dimensions
      if (embeddings.length > 0) {
        const textEmbeddingDims = embeddings[0].dimensions;
        console.log(`📏 Dimension comparison:`);
        console.log(`   └── Text embedding: ${textEmbeddingDims}D`);
        console.log(`   └── Image embedding: ${thumbnailEmbedding.length}D`);
        console.log(`   └── Compatible: ${textEmbeddingDims === thumbnailEmbedding.length ? '✅' : '❌'}`);
      }
      
    } catch (error) {
      console.log(`❌ Thumbnail embedding failed: ${error.message}`);
    }
    
    // 5. Test cross-modal similarity (text query vs image embeddings)
    console.log('\n5️⃣ TESTING CROSS-MODAL SIMILARITY');
    console.log('-'.repeat(40));
    
    // This would require more sophisticated testing with known thumbnail-query pairs
    console.log('🔄 Testing cross-modal compatibility...');
    
    // Summary and recommendations
    console.log('\n📋 SUMMARY AND RECOMMENDATIONS');
    console.log('=' * 50);
    
    console.log('\n🎯 Key Findings:');
    console.log(`   1. Index has ${stats.totalVectorCount || 0} vectors`);
    console.log(`   2. Generated ${embeddings.length}/${testQueries.length} text embeddings successfully`);
    
    console.log('\n💡 Recommendations:');
    if (!stats.totalVectorCount || stats.totalVectorCount === 0) {
      console.log('   ❗ CRITICAL: Populate thumbnail index with video embeddings');
    } else {
      console.log('   ✅ Thumbnail index has data');
    }
    
    if (embeddings.length === 0) {
      console.log('   ❗ CRITICAL: Fix CLIP text-to-visual embedding generation');
    } else {
      console.log('   ✅ CLIP text embeddings working');
    }
    
    console.log('   📊 Consider threshold 0.3 for broader visual search results');
    console.log('   🔧 Test with more diverse visual queries');
    console.log('   📈 Monitor cross-modal embedding quality');
    
  } catch (error) {
    console.error('❌ Debug test failed:', error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}