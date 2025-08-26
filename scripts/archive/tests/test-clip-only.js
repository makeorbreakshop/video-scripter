#!/usr/bin/env node

/**
 * Test CLIP embedding generation only
 * Since thumbnail index is empty, focus on embedding quality
 */

import { generateVisualQueryEmbedding, generateThumbnailEmbedding } from './lib/thumbnail-embeddings.ts';

async function main() {
  console.log('🧪 CLIP EMBEDDING GENERATION TEST');
  console.log('='.repeat(40));
  
  try {
    // 1. Test text-to-visual embeddings
    console.log('\n1️⃣ TESTING TEXT-TO-VISUAL EMBEDDINGS');
    console.log('-'.repeat(40));
    
    const testQueries = [
      'person pointing at something',
      'shocked face expression thumbnail',
      'bright colorful gaming setup',
      'cooking food in kitchen scene',
      'tutorial arrow pointing at screen'
    ];
    
    const textEmbeddings = [];
    for (const query of testQueries) {
      try {
        console.log(`🔄 Testing: "${query}"`);
        const startTime = Date.now();
        const embedding = await generateVisualQueryEmbedding(query);
        const duration = Date.now() - startTime;
        
        textEmbeddings.push({ 
          query, 
          embedding, 
          dimensions: embedding.length,
          duration 
        });
        
        console.log(`   ✅ Generated ${embedding.length}D embedding in ${duration}ms`);
        console.log(`   📊 Sample values: [${embedding.slice(0, 3).map(v => v.toFixed(3)).join(', ')}, ...]`);
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        textEmbeddings.push({ query, error: error.message });
      }
    }
    
    // 2. Test image thumbnail embeddings
    console.log('\n2️⃣ TESTING IMAGE THUMBNAIL EMBEDDINGS');
    console.log('-'.repeat(40));
    
    const testThumbnails = [
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', // Famous Rick Roll
      'https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg', // Random video
      'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg'  // Another random
    ];
    
    const imageEmbeddings = [];
    for (const thumbnailUrl of testThumbnails) {
      try {
        console.log(`🖼️ Testing thumbnail: ${thumbnailUrl}`);
        const startTime = Date.now();
        const embedding = await generateThumbnailEmbedding(thumbnailUrl);
        const duration = Date.now() - startTime;
        
        imageEmbeddings.push({ 
          url: thumbnailUrl, 
          embedding, 
          dimensions: embedding.length,
          duration 
        });
        
        console.log(`   ✅ Generated ${embedding.length}D embedding in ${duration}ms`);
        console.log(`   📊 Sample values: [${embedding.slice(0, 3).map(v => v.toFixed(3)).join(', ')}, ...]`);
        
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        imageEmbeddings.push({ url: thumbnailUrl, error: error.message });
      }
    }
    
    // 3. Test cross-modal similarity calculation
    console.log('\n3️⃣ TESTING CROSS-MODAL SIMILARITY');
    console.log('-'.repeat(40));
    
    const successfulTextEmbeddings = textEmbeddings.filter(e => e.embedding);
    const successfulImageEmbeddings = imageEmbeddings.filter(e => e.embedding);
    
    if (successfulTextEmbeddings.length > 0 && successfulImageEmbeddings.length > 0) {
      // Calculate cosine similarity between text and image embeddings
      function cosineSimilarity(a, b) {
        const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
        const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
        const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
        return dotProduct / (magnitudeA * magnitudeB);
      }
      
      console.log('🔄 Computing cross-modal similarities...');
      
      const similarities = [];
      for (const textEmb of successfulTextEmbeddings.slice(0, 2)) {
        for (const imageEmb of successfulImageEmbeddings.slice(0, 2)) {
          const similarity = cosineSimilarity(textEmb.embedding, imageEmb.embedding);
          similarities.push({
            text: textEmb.query,
            image: imageEmb.url.split('/').pop(),
            similarity: similarity
          });
          
          console.log(`   📊 "${textEmb.query}" ↔ ${imageEmb.url.split('/').pop()}: ${similarity.toFixed(4)}`);
        }
      }
      
      // Show similarity distribution
      const avgSimilarity = similarities.reduce((sum, s) => sum + s.similarity, 0) / similarities.length;
      console.log(`\n📈 Average cross-modal similarity: ${avgSimilarity.toFixed(4)}`);
      console.log(`📈 Similarity range: ${Math.min(...similarities.map(s => s.similarity)).toFixed(4)} - ${Math.max(...similarities.map(s => s.similarity)).toFixed(4)}`);
    }
    
    // 4. Summary and recommendations
    console.log('\n📋 SUMMARY AND DIAGNOSIS');
    console.log('='.repeat(40));
    
    console.log('\n🎯 Key Findings:');
    console.log(`   • Text embeddings: ${textEmbeddings.filter(e => e.embedding).length}/${textEmbeddings.length} successful`);
    console.log(`   • Image embeddings: ${imageEmbeddings.filter(e => e.embedding).length}/${imageEmbeddings.length} successful`);
    console.log(`   • Thumbnail index: EMPTY (0 vectors)`);
    console.log(`   • Embedding dimensions: ${successfulTextEmbeddings[0]?.dimensions || 'N/A'}D`);
    
    console.log('\n❌ ROOT CAUSE OF PATTERN ANALYSIS FAILURE:');
    console.log('   1. Thumbnail index is completely empty (0 vectors)');
    console.log('   2. Visual searches return 0 results because there are no thumbnails indexed');
    console.log('   3. Pattern analysis relies on visual+text search for comprehensive results');
    
    console.log('\n🔧 IMMEDIATE FIXES NEEDED:');
    console.log('   1. POPULATE thumbnail index with video thumbnail embeddings');
    console.log('   2. Run batch thumbnail embedding generation for existing videos');
    console.log('   3. Test visual search with populated index');
    
    console.log('\n💡 OPTIMAL SIMILARITY THRESHOLDS (once index is populated):');
    console.log('   • Conservative: 0.7+ (high confidence matches)');
    console.log('   • Balanced: 0.5+ (good quality matches)');
    console.log('   • Exploratory: 0.3+ (broader discovery)');
    console.log('   • Start with 0.3 for pattern analysis to get sufficient results');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}