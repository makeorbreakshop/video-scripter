#!/usr/bin/env node

/**
 * Test the pattern analysis fix - should now get visual search results
 */

async function main() {
  console.log('🧪 TESTING PATTERN ANALYSIS FIX');
  console.log('='.repeat(40));
  
  try {
    console.log('🔄 Running pattern analysis with fixed threshold (0.2)...');
    
    const response = await fetch('http://localhost:3000/api/analyze-pattern', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId: 'pjSgFEvOGAY', // Same video from your log
        analysisType: 'enhanced'
      })
    });
    
    if (!response.ok) {
      console.error('❌ API Error:', response.status, response.statusText);
      return;
    }
    
    const data = await response.json();
    
    console.log('\n📊 RESULTS SUMMARY:');
    console.log('-'.repeat(30));
    
    if (data.debugInfo) {
      const textResults = data.debugInfo.searchResults?.titleSearchResults?.results?.length || 0;
      const visualResults = data.debugInfo.visualSearchResults || [];
      
      console.log(`✅ Text search results: ${textResults}`);
      console.log(`🖼️ Visual search queries: ${visualResults.length}`);
      
      let totalVisualResults = 0;
      for (const visual of visualResults) {
        console.log(`   └── "${visual.query}": ${visual.found} results (threshold: ${visual.threshold})`);
        totalVisualResults += visual.found || 0;
      }
      
      console.log(`📊 Total visual results: ${totalVisualResults}`);
      console.log(`🎯 Validation pool: ${data.debugInfo.finalValidationSet?.length || 0} videos`);
      console.log(`✅ Final validated: ${data.validatedVideos?.length || 0} videos`);
      
      console.log('\n🔍 KEY IMPROVEMENT:');
      if (totalVisualResults > 0) {
        console.log('✅ Visual searches now returning results!');
        console.log('✅ Multi-modal pattern analysis working');
        console.log('✅ Should have larger validation pool');
      } else {
        console.log('❌ Visual searches still returning 0 results');
        console.log('❌ May need even lower threshold (0.1?)');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}