#!/usr/bin/env node

async function testImprovedTitleGenerator() {
  console.log('🧪 Testing IMPROVED Title Generator (80 videos per thread)...\n');
  
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
    
    // Check results
    console.log('📊 RESULTS:');
    console.log(`   ✅ Total patterns found: ${data.suggestions.length}`);
    console.log(`   ✅ Videos analyzed: ${data.debug?.totalVideosFound || 0}`);
    console.log(`   ✅ Processing time: ${data.processing_time_ms}ms`);
    
    // Show pattern evidence
    if (data.suggestions.length > 0) {
      console.log('\n🔍 Pattern Evidence:');
      data.suggestions.slice(0, 3).forEach((suggestion, idx) => {
        console.log(`\n   Pattern ${idx + 1}: "${suggestion.title}"`);
        console.log(`   - Pattern name: ${suggestion.pattern.name}`);
        console.log(`   - Evidence strength: ${suggestion.evidence.sample_size} videos`);
        console.log(`   - Performance lift: ${suggestion.pattern.performance_lift.toFixed(1)}x`);
        console.log(`   - Examples: ${suggestion.pattern.examples.length} titles`);
        
        if (suggestion.pattern.verification) {
          const v = suggestion.pattern.verification;
          console.log(`   - Verification matches: ${v.matchCount}`);
          console.log(`   - Verification score: ${Math.round(v.verificationScore * 100)}%`);
        }
      });
    } else {
      console.log('\n❌ No patterns found - check verification filtering');
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  }
}

// Run the test
testImprovedTitleGenerator();