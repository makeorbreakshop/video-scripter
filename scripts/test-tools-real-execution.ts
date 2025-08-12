#!/usr/bin/env npx tsx
/**
 * REAL TOOL EXECUTION TEST
 * Tests actual tool calls with proper parameters
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Import tool registry and executor
import { getToolRegistry } from '../lib/orchestrator/tool-registry';
import { executeToolWithCache } from '../lib/agentic/tool-executor';
import { ToolContext } from '../types/orchestrator';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testRealTools() {
  log('\n🔬 TESTING REAL TOOL EXECUTION WITH PROPER CONTEXT\n', 'bright');
  
  // Create proper context
  const context: ToolContext = {
    requestId: `test-${Date.now()}`,
    sessionId: 'test-session',
    mode: 'agentic',
    userId: 'test-user'
  };
  
  // Get the tool registry instance
  const toolRegistry = getToolRegistry();
  
  // Test tools one by one
  const tests = [
    {
      name: 'search_titles',
      params: { query: 'satisfying', limit: 5 }
    },
    {
      name: 'get_video_bundle', 
      params: { video_id: 'U5GHwG3_RAo' }
    },
    {
      name: 'search_summaries',
      params: { query: 'oddly satisfying', limit: 5 }
    }
  ];
  
  for (const test of tests) {
    log(`\nTesting ${test.name}:`, 'cyan');
    
    // Get tool definition from registry
    const tool = toolRegistry.get(test.name);
    
    if (!tool) {
      log(`   ❌ Tool not found in registry!`, 'red');
      continue;
    }
    
    log(`   Tool found: ${tool.description}`, 'green');
    
    try {
      // Execute with proper parameters
      const startTime = Date.now();
      const result = await executeToolWithCache(
        tool,
        test.params,
        context,
        false // Don't use cache for testing
      );
      const duration = Date.now() - startTime;
      
      log(`   ✅ Execution successful in ${duration}ms`, 'green');
      
      // Analyze result
      if (result) {
        const resultStr = JSON.stringify(result);
        const hasMockData = resultStr.includes('mock-') || resultStr.includes('rb-00');
        
        if (hasMockData) {
          log(`   ⚠️  WARNING: Result contains mock data!`, 'red');
          log(`   Sample: ${resultStr.substring(0, 200)}...`, 'yellow');
        } else {
          log(`   ✅ Real data returned`, 'green');
          
          // Show sample of real data
          if (test.name === 'search_titles' && result.results) {
            log(`   Found ${result.results.length} real videos`, 'green');
            if (result.results[0]) {
              log(`   First: ${result.results[0].video_id} (score: ${result.results[0].score})`, 'green');
            }
          } else if (test.name === 'get_video_bundle' && result.video) {
            log(`   Video: ${result.video.title}`, 'green');
            log(`   TPS: ${result.video.temporal_performance_score}`, 'green');
          }
        }
      }
      
    } catch (error: any) {
      log(`   ❌ ERROR: ${error.message}`, 'red');
      
      // Check if it's an endpoint issue
      if (error.message.includes('No endpoint')) {
        log(`   Tool name might be mismatched in registry`, 'yellow');
      } else if (error.message.includes('fetch')) {
        log(`   Network/API issue`, 'yellow');
      }
    }
  }
  
  // Now test the orchestrator's tool execution
  log('\n\n📋 TESTING ORCHESTRATOR INTEGRATION:', 'cyan');
  
  try {
    const { runIdeaHeistAgent } = await import('../lib/agentic/orchestrator/idea-heist-agent');
    log('   Orchestrator loaded ✅', 'green');
    
    // Check if it's using real tools
    const orchestratorPath = path.join(process.cwd(), 'lib/agentic/orchestrator/idea-heist-agent.ts');
    const fs = await import('fs');
    const content = fs.readFileSync(orchestratorPath, 'utf-8');
    
    // Look for the useRealTools flag
    const realToolsMatch = content.match(/const useRealTools = (true|false)/);
    if (realToolsMatch) {
      const useRealTools = realToolsMatch[1] === 'true';
      log(`   useRealTools flag: ${useRealTools ? '✅ TRUE' : '❌ FALSE'}`, useRealTools ? 'green' : 'red');
      
      if (!useRealTools) {
        log(`   ⚠️  ORCHESTRATOR IS USING MOCK TOOLS!`, 'red');
        log(`   Change line: const useRealTools = false → true`, 'yellow');
      }
    }
    
    // Check for mock evidence generation
    const hasMockGeneration = content.includes('generateMockEvidence');
    if (hasMockGeneration) {
      log(`   ⚠️  Orchestrator has generateMockEvidence function`, 'yellow');
      
      // Find where it's used
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes('generateMockEvidence()')) {
          log(`   Line ${idx + 1}: ${line.trim()}`, 'red');
        }
      });
    }
    
  } catch (error: any) {
    log(`   Failed to check orchestrator: ${error.message}`, 'red');
  }
  
  // Test API endpoint directly
  log('\n\n🌐 TESTING API ENDPOINT DIRECTLY:', 'cyan');
  
  try {
    const response = await fetch('http://localhost:3000/api/tools/search-titles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'satisfying', limit: 3 })
    });
    
    const data = await response.json();
    
    if (data.success && data.data?.results) {
      const results = data.data.results;
      log(`   API returned ${results.length} results`, 'green');
      
      if (results.length > 0) {
        const hasMocks = results.some((r: any) => 
          r.video_id.startsWith('mock-') || r.video_id.startsWith('rb-')
        );
        
        if (hasMocks) {
          log(`   ❌ API is returning mock data!`, 'red');
          log(`   Results: ${JSON.stringify(results)}`, 'yellow');
        } else {
          log(`   ✅ API returns real data`, 'green');
          log(`   First result: ${results[0].video_id}`, 'green');
        }
      } else {
        log(`   ⚠️  No results returned (Pinecone might be empty)`, 'yellow');
      }
    } else {
      log(`   ❌ API error: ${JSON.stringify(data)}`, 'red');
    }
    
  } catch (error: any) {
    log(`   Failed to test API: ${error.message}`, 'red');
  }
}

// Run tests
testRealTools().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});