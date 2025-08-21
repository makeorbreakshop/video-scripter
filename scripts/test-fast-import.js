#!/usr/bin/env node

/**
 * Test script to verify fast import with new defaults
 * (skipThumbnailEmbeddings and skipSummaries both default to true)
 */

async function testFastImport() {
  console.log('🚀 Testing fast import with new defaults...\n');
  
  // Test with a small set of videos
  const testVideoIds = [
    'dQw4w9WgXcQ', // Rick Astley - Never Gonna Give You Up
    'jNQXAC9IVRw'  // Me at the zoo (first YouTube video)
  ];
  
  try {
    // Test 1: Import with defaults (should skip thumbnails and summaries)
    console.log('📊 Test 1: Import with defaults (should be fast)');
    console.log('Expected: skipThumbnailEmbeddings=true, skipSummaries=true\n');
    
    const response1 = await fetch('http://localhost:3000/api/video-import/unified', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'discovery',
        videoIds: testVideoIds,
        useQueue: false, // Process synchronously for immediate results
        options: {
          // Not setting skipThumbnailEmbeddings or skipSummaries
          // They should default to true
        }
      })
    });
    
    const result1 = await response1.json();
    console.log('Result:', {
      success: result1.success,
      videosProcessed: result1.videosProcessed,
      titleEmbeddings: result1.embeddingsGenerated?.titles || 0,
      thumbnailEmbeddings: result1.embeddingsGenerated?.thumbnails || 0,
      summariesGenerated: result1.summariesGenerated || 0
    });
    
    if (result1.embeddingsGenerated?.thumbnails > 0) {
      console.log('❌ ERROR: Thumbnail embeddings were generated when they should be skipped by default!');
    } else {
      console.log('✅ SUCCESS: Thumbnail embeddings skipped as expected');
    }
    
    if (result1.summariesGenerated > 0) {
      console.log('❌ ERROR: Summaries were generated when they should be skipped by default!');
    } else {
      console.log('✅ SUCCESS: Summaries skipped as expected');
    }
    
    console.log('\n---\n');
    
    // Test 2: Explicitly enable thumbnails and summaries
    console.log('📊 Test 2: Explicitly enable thumbnails and summaries (should be slower)');
    console.log('Expected: skipThumbnailEmbeddings=false, skipSummaries=false\n');
    
    const response2 = await fetch('http://localhost:3000/api/video-import/unified', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'discovery',
        videoIds: [testVideoIds[0]], // Just one video to keep it quick
        useQueue: false,
        options: {
          skipThumbnailEmbeddings: false, // Explicitly enable
          skipSummaries: false // Explicitly enable
        }
      })
    });
    
    const result2 = await response2.json();
    console.log('Result:', {
      success: result2.success,
      videosProcessed: result2.videosProcessed,
      titleEmbeddings: result2.embeddingsGenerated?.titles || 0,
      thumbnailEmbeddings: result2.embeddingsGenerated?.thumbnails || 0,
      summariesGenerated: result2.summariesGenerated || 0
    });
    
    if (result2.embeddingsGenerated?.thumbnails === 0) {
      console.log('❌ ERROR: Thumbnail embeddings were NOT generated when explicitly enabled!');
    } else {
      console.log('✅ SUCCESS: Thumbnail embeddings generated as requested');
    }
    
    if (result2.summariesGenerated === 0) {
      console.log('❌ ERROR: Summaries were NOT generated when explicitly enabled!');
    } else {
      console.log('✅ SUCCESS: Summaries generated as requested');
    }
    
    console.log('\n✅ All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testFastImport().catch(console.error);