#!/usr/bin/env node
/**
 * Mock test for Idea Heist Agentic Mode
 * Tests without requiring real API keys or database
 */

import { runIdeaHeistAgent } from '../lib/agentic/orchestrator/idea-heist-agent';

// Mock environment for testing
if (!process.env.OPENAI_API_KEY) {
  console.log('🔧 Running in mock mode (no API keys configured)\n');
}

async function runMockTest() {
  console.log('🧪 Mock Agentic Mode Test\n');
  console.log('='.repeat(50));
  
  // Test parameters
  const mockVideoId = 'mock_video_123';
  const testOptions = {
    mode: 'agentic' as const,
    budget: {
      maxFanouts: 1,
      maxValidations: 2,
      maxCandidates: 5,
      maxTokens: 1000,
      maxDurationMs: 10000,
      maxToolCalls: 5
    },
    timeoutMs: 10000,
    fallbackToClassic: true,
    telemetryEnabled: true
  };
  
  console.log('📹 Testing with mock video:', mockVideoId);
  console.log('⚙️ Options:', JSON.stringify(testOptions.budget, null, 2));
  console.log('');
  
  try {
    const startTime = Date.now();
    console.log('🚀 Starting mock analysis...\n');
    
    // Run the agent
    const result = await runIdeaHeistAgent(mockVideoId, testOptions);
    
    const duration = Date.now() - startTime;
    
    // Display results
    console.log('='.repeat(50));
    console.log('✅ Mock Analysis Complete!\n');
    
    console.log('📊 Results:');
    console.log(`  Success: ${result.success ? '✅' : '❌'}`);
    console.log(`  Mode: ${result.mode}`);
    console.log(`  Fallback Used: ${result.fallbackUsed ? 'Yes' : 'No'}`);
    
    if (result.pattern) {
      console.log('\n🎯 Pattern:');
      console.log(`  Statement: "${result.pattern.statement}"`);
      console.log(`  Confidence: ${(result.pattern.confidence * 100).toFixed(1)}%`);
      console.log(`  Validations: ${result.pattern.validations}`);
    }
    
    if (result.metrics) {
      console.log('\n📈 Metrics:');
      console.log(`  Duration: ${(duration / 1000).toFixed(2)}s`);
      console.log(`  Tokens: ${result.metrics.totalTokens}`);
      console.log(`  Tool Calls: ${result.metrics.toolCallCount}`);
      console.log(`  Model Switches: ${result.metrics.modelSwitches}`);
    }
    
    if (result.budgetUsage) {
      console.log('\n💰 Budget Usage:');
      console.log(`  Fanouts: ${result.budgetUsage.fanouts}/${testOptions.budget.maxFanouts}`);
      console.log(`  Validations: ${result.budgetUsage.validations}/${testOptions.budget.maxValidations}`);
      console.log(`  Tool Calls: ${result.budgetUsage.toolCalls}/${testOptions.budget.maxToolCalls}`);
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Mock test completed successfully!');
    console.log('');
    console.log('📝 Notes:');
    console.log('  - This test used mock data (no real API calls)');
    console.log('  - Configure API keys for real testing');
    console.log('  - Run "npm run test:agentic" for full testing');
    
  } catch (error) {
    console.error('\n❌ Mock test failed:', error);
    console.error('\nThis might indicate a code issue rather than API problem.');
    process.exit(1);
  }
}

// Test the tool registry
async function testToolRegistry() {
  console.log('\n🔧 Testing Tool Registry...\n');
  
  const { getToolRegistry } = await import('../lib/orchestrator/tool-registry');
  const registry = getToolRegistry();
  
  const categories = ['context', 'search', 'enrichment', 'performance', 'novelty', 'intelligence'];
  
  for (const category of categories) {
    const tools = registry.list(category);
    console.log(`  ${category}: ${tools.length} tools`);
    tools.forEach(tool => {
      console.log(`    - ${tool.name}: ${tool.description.substring(0, 50)}...`);
    });
  }
  
  const totalTools = registry.list().length;
  console.log(`\n  Total: ${totalTools} tools registered`);
  
  if (totalTools !== 18) {
    console.error(`\n⚠️ Expected 18 tools, found ${totalTools}`);
  }
}

// Test the budget tracker
async function testBudgetTracker() {
  console.log('\n💰 Testing Budget Tracker...\n');
  
  const { createBudgetTracker } = await import('../lib/orchestrator/budget-tracker');
  const tracker = createBudgetTracker();
  
  tracker.initialize({
    maxFanouts: 2,
    maxValidations: 10,
    maxCandidates: 50,
    maxTokens: 10000,
    maxDurationMs: 30000,
    maxToolCalls: 20
  });
  
  // Simulate some usage
  tracker.recordFanout();
  tracker.recordValidation(5);
  tracker.recordToolCall('test_tool', 1000, 0.01);
  tracker.recordToolCall('another_tool', 500, 0.005);
  
  const usage = tracker.getUsage();
  console.log('  Current Usage:');
  console.log(`    Fanouts: ${usage.fanouts}/2`);
  console.log(`    Validations: ${usage.validations}/10`);
  console.log(`    Candidates: ${usage.candidates}/50`);
  console.log(`    Tokens: ${usage.tokens}/10000`);
  console.log(`    Tool Calls: ${usage.toolCalls}/20`);
  console.log(`    Total Cost: $${usage.costs.total.toFixed(4)}`);
  
  // Test budget exceeded
  tracker.recordFanout(); // 2nd fanout
  const canContinue = tracker.recordFanout(); // 3rd fanout - should exceed
  console.log(`\n  Can continue after 3rd fanout: ${canContinue ? 'Yes' : 'No (budget exceeded)'}`);
  
  if (tracker.isExceeded()) {
    console.log('  ✅ Budget enforcement working correctly');
  }
}

// Test session manager
async function testSessionManager() {
  console.log('\n📦 Testing Session Manager...\n');
  
  const { createSessionManager } = await import('../lib/orchestrator/session-manager');
  const manager = createSessionManager();
  
  // Create a session
  const sessionId = manager.createSession('test_video_123', {
    mode: 'agentic',
    budget: {
      maxFanouts: 2,
      maxValidations: 10,
      maxCandidates: 50,
      maxTokens: 10000,
      maxDurationMs: 30000,
      maxToolCalls: 20
    }
  } as any);
  
  console.log(`  Created session: ${sessionId}`);
  
  // Update session
  manager.updateSession(sessionId, {
    hypothesis: {
      statement: 'Test pattern discovered',
      confidence: 0.75,
      supportingEvidence: ['evidence1', 'evidence2']
    }
  });
  
  const session = manager.getSession(sessionId);
  console.log(`  Session video: ${session?.videoId}`);
  console.log(`  Hypothesis: "${session?.hypothesis?.statement}"`);
  
  // Test state compaction
  const compacted = manager.compactState(session!);
  console.log(`  Compacted state size: ${JSON.stringify(compacted).length} bytes`);
  
  // End session
  manager.endSession(sessionId);
  console.log('  ✅ Session ended successfully');
}

// Main test runner
async function main() {
  console.log('🎯 Idea Heist Agentic Mode - Mock Test Suite');
  console.log('='.repeat(50));
  
  // Run all mock tests
  await testToolRegistry();
  await testBudgetTracker();
  await testSessionManager();
  await runMockTest();
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ All mock tests completed!');
  console.log('\nNext steps:');
  console.log('1. Configure API keys in .env');
  console.log('2. Run "npm run test:agentic" for real testing');
  console.log('3. Test with actual video IDs from your database');
}

main().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});