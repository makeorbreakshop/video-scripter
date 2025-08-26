#!/usr/bin/env npx tsx
/**
 * Test script to verify agentic mode returns correct structure for UI
 */

import { runIdeaHeistAgent } from '@/lib/agentic/orchestrator/idea-heist-agent';

async function testAgenticUIIntegration() {
  console.log('🧪 Testing Agentic Mode UI Integration...\n');
  
  // Test video ID
  const videoId = 'gRfQI--GXZo';
  
  try {
    console.log('📋 Running agentic analysis...');
    const result = await runIdeaHeistAgent(videoId, {
      timeoutMs: 30000, // 30 seconds for quick test
      budget: {
        maxFanouts: 2,
        maxValidations: 5,
        maxCandidates: 20,
        maxTokens: 10000,
        maxDurationMs: 30000,
        maxToolCalls: 20
      }
    });
    
    console.log('\n✅ Analysis Complete!');
    console.log('====================\n');
    
    // Check if result has the expected structure
    console.log('📊 Structure Validation:');
    console.log('  - success:', result.success ? '✅' : '❌');
    console.log('  - mode:', result.mode === 'agentic' ? '✅ agentic' : '❌ ' + result.mode);
    console.log('  - pattern:', result.pattern ? '✅ Present' : '❌ Missing');
    console.log('  - source_video:', result.source_video ? '✅ Present' : '❌ Missing');
    console.log('  - validation:', result.validation ? '✅ Present' : '❌ Missing');
    console.log('  - debug:', result.debug ? '✅ Present' : '❌ Missing');
    console.log('  - metrics:', result.metrics ? '✅ Present' : '❌ Missing');
    
    if (result.pattern) {
      console.log('\n📋 Pattern Structure:');
      console.log('  - pattern_name:', result.pattern.pattern_name ? '✅' : '❌');
      console.log('  - pattern_type:', result.pattern.pattern_type ? '✅' : '❌');
      console.log('  - confidence:', typeof result.pattern.confidence === 'number' ? '✅' : '❌');
      console.log('  - validations:', typeof result.pattern.validations === 'number' ? '✅' : '❌');
      console.log('  - niches:', Array.isArray(result.pattern.niches) ? '✅' : '❌');
      console.log('  - evidence:', Array.isArray(result.pattern.evidence) ? '✅' : '❌');
      
      console.log('\n  Pattern Details:');
      console.log('    Name:', result.pattern.pattern_name || 'N/A');
      console.log('    Type:', result.pattern.pattern_type || 'N/A');
      console.log('    Confidence:', result.pattern.confidence || 0);
      console.log('    Validations:', result.pattern.validations || 0);
    }
    
    if (result.source_video) {
      console.log('\n🎥 Source Video Structure:');
      console.log('  - id:', result.source_video.id ? '✅' : '❌');
      console.log('  - title:', result.source_video.title ? '✅' : '❌');
      console.log('  - channel:', result.source_video.channel ? '✅' : '❌');
      console.log('  - score:', typeof result.source_video.score === 'number' ? '✅' : '❌');
      console.log('  - views:', typeof result.source_video.views === 'number' ? '✅' : '❌');
      console.log('  - thumbnail:', result.source_video.thumbnail ? '✅' : '❌');
      console.log('  - baseline:', typeof result.source_video.baseline === 'number' ? '✅' : '❌');
      
      console.log('\n  Video Details:');
      console.log('    Title:', result.source_video.title || 'N/A');
      console.log('    Channel:', result.source_video.channel || 'N/A');
      console.log('    Performance:', result.source_video.score ? `${result.source_video.score.toFixed(1)}x` : 'N/A');
      console.log('    Views:', result.source_video.views || 0);
    }
    
    if (result.validation) {
      console.log('\n✓ Validation Structure:');
      console.log('  - results:', Array.isArray(result.validation.results) ? '✅' : '❌');
      console.log('  - total_validations:', typeof result.validation.total_validations === 'number' ? '✅' : '❌');
      console.log('  - pattern_strength:', typeof result.validation.pattern_strength === 'number' ? '✅' : '❌');
      console.log('  - avg_pattern_score:', typeof result.validation.avg_pattern_score === 'number' ? '✅' : '❌');
      
      if (result.validation.results && result.validation.results.length > 0) {
        console.log('\n  First Validation Result:');
        const first = result.validation.results[0];
        console.log('    Niche:', first.niche || 'N/A');
        console.log('    Videos:', Array.isArray(first.videos) ? first.videos.length : 0);
        console.log('    Pattern Score:', first.pattern_score || 0);
      }
    }
    
    // Test if the structure matches what displayAnalysis expects
    console.log('\n🖥️  UI Compatibility Check:');
    const hasRequiredFields = 
      result.pattern && 
      result.source_video && 
      result.validation;
    
    if (hasRequiredFields) {
      console.log('  ✅ Structure compatible with displayAnalysis()');
      
      // Simulate what the UI would see
      const { pattern, source_video, validation } = result;
      console.log('\n  UI would receive:');
      console.log('    - Pattern name:', pattern.pattern_name || 'Missing');
      console.log('    - Video title:', source_video.title || 'Missing');
      console.log('    - Validations:', validation.total_validations || 0);
    } else {
      console.log('  ❌ Missing required fields for UI display');
      if (!result.pattern) console.log('     - Missing: pattern');
      if (!result.source_video) console.log('     - Missing: source_video');
      if (!result.validation) console.log('     - Missing: validation');
    }
    
    // Save full result for debugging
    const fs = await import('fs');
    const outputPath = '/Users/brandoncullum/video-scripter/data/agentic-ui-test-result.json';
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\n💾 Full result saved to: ${outputPath}`);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Stack:', error instanceof Error ? error.stack : '');
  }
}

// Run the test
testAgenticUIIntegration().catch(console.error);