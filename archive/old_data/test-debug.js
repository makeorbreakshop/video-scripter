#!/usr/bin/env node

async function testWithDebug() {
  console.log('🧪 Testing with debug output...\n');
  
  try {
    const response = await fetch('http://localhost:3000/api/youtube/patterns/generate-titles', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        concept: "simple cooking tips",
        options: {
          maxSuggestions: 3,
          includeExamples: true
        }
      }),
    });

    if (!response.ok) {
      console.error('❌ API error:', response.status, response.statusText);
      return;
    }

    const data = await response.json();
    
    console.log('📊 API Response:');
    console.log('- Suggestions:', data.suggestions?.length || 0);
    console.log('- Processing time:', data.processing_time_ms + 'ms');
    
    // Check if there are processing steps about verification
    if (data.debug?.processingSteps) {
      const verificationStep = data.debug.processingSteps.find(s => s.step.includes('Verification'));
      if (verificationStep) {
        console.log('\n🔍 Verification Details:');
        console.log('- Patterns analyzed:', verificationStep.details?.patternsAnalyzed || 0);
        console.log('- Patterns verified:', verificationStep.details?.patternsVerified || 0);
        console.log('- Patterns filtered:', verificationStep.details?.patternsFiltered || 0);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testWithDebug();