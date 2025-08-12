#!/usr/bin/env node
/**
 * Test script for Idea Heist Agentic Mode
 * Tests the complete agentic analysis pipeline
 */

import dotenv from 'dotenv';
import { runIdeaHeistAgent } from '../lib/agentic/orchestrator/idea-heist-agent';
import { isOpenAIConfigured } from '../lib/agentic/openai-integration';

// Load environment variables
dotenv.config();

async function testAgenticMode() {
  console.log('🧪 Testing Idea Heist Agentic Mode\n');
  console.log('='.repeat(50));
  
  // Check configuration
  console.log('📋 Configuration Check:');
  console.log(`  OpenAI API: ${isOpenAIConfigured() ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`  Pinecone: ${process.env.PINECONE_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`  Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ Configured' : '❌ Not configured'}`);
  console.log('');
  
  // Test video ID (you can change this to any video in your database)
  const testVideoId = process.argv[2] || 'dQw4w9WgXcQ'; // Default to Rick Roll if no video provided
  
  console.log(`🎬 Testing with video ID: ${testVideoId}`);
  console.log('='.repeat(50));
  console.log('');
  
  try {
    // Run the agent with minimal budget for testing
    console.log('🚀 Starting agentic analysis...\n');
    
    const startTime = Date.now();
    
    const result = await runIdeaHeistAgent(testVideoId, {
      mode: 'agentic',
      budget: {
        maxFanouts: 1,        // Minimal for testing
        maxValidations: 5,    // Minimal for testing
        maxCandidates: 20,    // Minimal for testing
        maxTokens: 10000,     // Reduced for testing
        maxDurationMs: 30000, // 30 seconds timeout
        maxToolCalls: 10      // Minimal for testing
      },
      timeoutMs: 30000,
      retryAttempts: 1,
      fallbackToClassic: true,
      parallelExecution: true,
      cacheResults: true,
      telemetryEnabled: true
    });
    
    const duration = Date.now() - startTime;
    
    // Display results
    console.log('✅ Analysis Complete!\n');
    console.log('='.repeat(50));
    console.log('📊 Results:');
    console.log(`  Success: ${result.success ? '✅' : '❌'}`);
    console.log(`  Mode: ${result.mode}`);
    console.log(`  Fallback Used: ${result.fallbackUsed ? 'Yes' : 'No'}`);
    console.log('');
    
    if (result.pattern) {
      console.log('🎯 Pattern Discovered:');
      console.log(`  Statement: ${result.pattern.statement}`);
      console.log(`  Confidence: ${(result.pattern.confidence * 100).toFixed(1)}%`);
      console.log(`  Validations: ${result.pattern.validations}`);
      console.log('');
    }
    
    if (result.metrics) {
      console.log('📈 Metrics:');
      console.log(`  Duration: ${(result.metrics.totalDurationMs / 1000).toFixed(2)}s`);
      console.log(`  Tokens Used: ${result.metrics.totalTokens.toLocaleString()}`);
      console.log(`  Cost: $${result.metrics.totalCost.toFixed(4)}`);
      console.log(`  Tool Calls: ${result.metrics.toolCallCount}`);
      console.log(`  Model Switches: ${result.metrics.modelSwitches}`);
      console.log('');
    }
    
    if (result.budgetUsage) {
      console.log('💰 Budget Usage:');
      const budget = result.options?.budget;
      console.log(`  Fanouts: ${result.budgetUsage.fanouts}/${budget?.maxFanouts || 'N/A'}`);
      console.log(`  Validations: ${result.budgetUsage.validations}/${budget?.maxValidations || 'N/A'}`);
      console.log(`  Tool Calls: ${result.budgetUsage.toolCalls}/${budget?.maxToolCalls || 'N/A'}`);
      console.log(`  Tokens: ${result.budgetUsage.tokens}/${budget?.maxTokens || 'N/A'}`);
      console.log('');
    }
    
    if (result.error) {
      console.log('⚠️ Error Details:');
      console.log(`  Code: ${result.error.code}`);
      console.log(`  Message: ${result.error.message}`);
      console.log('');
    }
    
    console.log('='.repeat(50));
    console.log(`⏱️ Total execution time: ${(duration / 1000).toFixed(2)}s`);
    
    // Save detailed results to file for debugging
    if (process.argv.includes('--save')) {
      const fs = require('fs');
      const outputPath = `./data/agentic-test-${Date.now()}.json`;
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      console.log(`\n💾 Detailed results saved to: ${outputPath}`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testAgenticMode()
  .then(() => {
    console.log('\n✅ Test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });

// Usage instructions
if (process.argv.includes('--help')) {
  console.log(`
Usage: npm run test:agentic [VIDEO_ID] [OPTIONS]

Options:
  --save     Save detailed results to a JSON file
  --help     Show this help message

Examples:
  npm run test:agentic                           # Test with default video
  npm run test:agentic abc123                    # Test with specific video
  npm run test:agentic abc123 --save             # Test and save results
`);
  process.exit(0);
}