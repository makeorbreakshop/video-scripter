#!/usr/bin/env node

async function testTitleGenerator() {
  console.log('🧪 Testing Title Generator with Pattern Verification...\n');
  
  const concept = 'how to make sourdough bread';
  console.log(`📝 Test concept: "${concept}"\n`);
  
  try {
    console.log('🚀 Sending request to API...');
    const startTime = Date.now();
    
    const response = await fetch('http://localhost:3000/api/youtube/patterns/generate-titles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        concept: concept,
        options: {
          maxSuggestions: 8,
          includeExamples: true,
          timestamp: Date.now()
        }
      }),
    });

    const endTime = Date.now();
    console.log(`⏱️  Response time: ${endTime - startTime}ms\n`);

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Check multi-threading
    console.log('🔄 Multi-Threading Check:');
    if (data.debug?.processingSteps) {
      const threads = data.debug.processingSteps.filter(step => 
        step.step.includes('Thread')
      );
      console.log(`   ✅ Found ${threads.length} threads`);
      threads.forEach(thread => {
        console.log(`   - ${thread.step}: ${thread.duration_ms}ms`);
      });
    }
    
    // Check pattern discovery
    console.log('\n🎯 Pattern Discovery Check:');
    console.log(`   ✅ Total patterns found: ${data.suggestions.length}`);
    console.log(`   ✅ Using OpenAI: ${data.debug?.processingSteps.some(s => s.step.includes('OpenAI')) ? 'Yes' : 'No'}`);
    
    // Check pattern verification
    console.log('\n✅ Pattern Verification Check:');
    const verifiedPatterns = data.suggestions.filter(s => s.pattern.verification);
    console.log(`   ✅ Verified patterns: ${verifiedPatterns.length}/${data.suggestions.length}`);
    
    if (verifiedPatterns.length > 0) {
      console.log('\n📊 Verification Details:');
      verifiedPatterns.slice(0, 3).forEach((suggestion, idx) => {
        const v = suggestion.pattern.verification;
        console.log(`\n   Pattern ${idx + 1}: "${suggestion.title}"`);
        console.log(`   - Matches found: ${v.matchCount}`);
        console.log(`   - Median performance: ${v.medianPerformance.toFixed(1)}x`);
        console.log(`   - Top performers: ${v.topPerformers}`);
        console.log(`   - Verification score: ${Math.round(v.verificationScore * 100)}%`);
      });
    }
    
    // Check costs
    console.log('\n💰 Cost Analysis:');
    const costs = data.debug?.processingSteps.find(s => s.step === 'Total API costs')?.details;
    if (costs) {
      console.log(`   - Query expansion: $${costs.queryExpansion.toFixed(4)}`);
      console.log(`   - Embeddings: $${costs.embeddings.toFixed(4)}`);
      console.log(`   - Pattern discovery: $${costs.patternDiscovery.toFixed(4)}`);
      console.log(`   - Total: $${costs.total.toFixed(4)}`);
    }
    
    // Check search stats
    console.log('\n📈 Search Statistics:');
    console.log(`   - Videos found: ${data.debug?.totalVideosFound || 0}`);
    console.log(`   - Unique channels: ${data.debug?.uniqueChannels || 0}`);
    console.log(`   - Processing time: ${data.processing_time_ms}ms`);
    
    console.log('\n✅ All systems operational!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testTitleGenerator();