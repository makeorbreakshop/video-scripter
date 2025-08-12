#!/usr/bin/env npx tsx
/**
 * FULL DEBUG TEST - Track every step of agentic execution
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment
dotenv.config({ path: path.join(process.cwd(), '.env') });

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

async function debugAgenticExecution() {
  log('\n🔍 DEBUGGING AGENTIC EXECUTION - FULL TRACE\n', 'bright');
  
  const videoId = 'U5GHwG3_RAo';
  
  // 1. Import the orchestrator
  log('1. Loading orchestrator...', 'cyan');
  const { runIdeaHeistAgent } = await import('../lib/agentic/orchestrator/idea-heist-agent');
  
  // 2. Check the source code for issues
  log('\n2. Analyzing orchestrator source code...', 'cyan');
  const orchestratorPath = path.join(process.cwd(), 'lib/agentic/orchestrator/idea-heist-agent.ts');
  const sourceCode = fs.readFileSync(orchestratorPath, 'utf-8');
  
  // Find all mock data generation
  const mockLines: number[] = [];
  const lines = sourceCode.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('mock-') || line.includes('rb-00') || line.includes('tnd-00')) {
      mockLines.push(idx + 1);
    }
  });
  
  if (mockLines.length > 0) {
    log(`   ⚠️  Found ${mockLines.length} lines with mock data:`, 'yellow');
    mockLines.slice(0, 5).forEach(lineNum => {
      log(`   Line ${lineNum}: ${lines[lineNum - 1].trim().substring(0, 80)}...`, 'yellow');
    });
  }
  
  // Check environment variable usage
  const envCheckLines = lines.filter(line => 
    line.includes('process.env.NEXT_PUBLIC_SUPABASE_URL') ||
    line.includes('useRealTools')
  );
  
  if (envCheckLines.length > 0) {
    log('\n   Environment checks found:', 'cyan');
    envCheckLines.forEach(line => {
      if (line.includes('NEXT_PUBLIC_SUPABASE_URL')) {
        log(`   ❌ Using NEXT_PUBLIC_SUPABASE_URL (won't work server-side)`, 'red');
        log(`      Should use: process.env.SUPABASE_URL`, 'yellow');
      }
    });
  }
  
  // 3. Test with real execution
  log('\n3. Testing real execution...', 'cyan');
  
  try {
    const startTime = Date.now();
    let lastLog = startTime;
    
    // Track what's happening
    const events: any[] = [];
    
    // Execute with full logging
    const result = await runIdeaHeistAgent(
      videoId,
      {
        maxFanoutRequests: 3,
        maxValidationRounds: 2,
        maxSearchRounds: 1,
        maxCandidates: 10,
        timeoutSeconds: 60,
        mode: 'agentic'
      },
      (event) => {
        const now = Date.now();
        const elapsed = ((now - startTime) / 1000).toFixed(1);
        const delta = ((now - lastLog) / 1000).toFixed(1);
        lastLog = now;
        
        events.push({ ...event, elapsed, delta });
        
        // Log key events
        if (event.type === 'turn_start') {
          log(`\n   [${elapsed}s] TURN START: ${event.turn}`, 'cyan');
        } else if (event.type === 'tool_call') {
          log(`   [${elapsed}s] TOOL CALL: ${event.tool} (+${delta}s)`, 'yellow');
          
          // Check if result has mock data
          if (event.result) {
            const resultStr = JSON.stringify(event.result);
            if (resultStr.includes('mock-') || resultStr.includes('rb-00')) {
              log(`      ❌ MOCK DATA RETURNED!`, 'red');
            } else if (resultStr.includes('error')) {
              log(`      ⚠️  Error: ${event.result.error}`, 'red');
            } else {
              log(`      ✅ Real data`, 'green');
            }
          }
        } else if (event.type === 'turn_complete') {
          log(`   [${elapsed}s] TURN COMPLETE: ${event.turn} (+${delta}s)`, 'blue');
          
          // Check tool count
          const toolsInTurn = events.filter(e => 
            e.type === 'tool_call' && 
            e.elapsed >= (parseFloat(elapsed) - parseFloat(delta))
          ).length;
          
          if (toolsInTurn === 0) {
            log(`      ⚠️  No tools called in this turn!`, 'yellow');
          } else {
            log(`      Tools called: ${toolsInTurn}`, 'green');
          }
        }
      }
    );
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Analyze results
    log('\n\n4. ANALYSIS RESULTS:', 'bright');
    log(`   Total time: ${totalTime}s`, 'cyan');
    
    // Count tool calls
    const toolCalls = events.filter(e => e.type === 'tool_call');
    log(`   Tool calls made: ${toolCalls.length}`, toolCalls.length > 0 ? 'green' : 'red');
    
    if (toolCalls.length > 0) {
      // Check for mock data
      const mockCalls = toolCalls.filter(tc => {
        const resultStr = JSON.stringify(tc.result || {});
        return resultStr.includes('mock-') || resultStr.includes('rb-00');
      });
      
      if (mockCalls.length > 0) {
        log(`   ❌ Mock tool calls: ${mockCalls.length}/${toolCalls.length}`, 'red');
      } else {
        log(`   ✅ All tool calls returned real data`, 'green');
      }
    }
    
    // Check final pattern
    if (result.pattern) {
      log('\n   Final Pattern:', 'magenta');
      log(`   "${result.pattern.statement}"`, 'magenta');
      log(`   Confidence: ${result.pattern.confidence}%`, 'magenta');
      
      // Check evidence
      if (result.pattern.evidence && result.pattern.evidence.length > 0) {
        const mockEvidence = result.pattern.evidence.filter((e: any) =>
          e.video_id.startsWith('mock-') || 
          e.video_id.startsWith('rb-') ||
          e.video_id.startsWith('tnd-')
        );
        
        if (mockEvidence.length > 0) {
          log(`   ❌ Mock evidence: ${mockEvidence.length}/${result.pattern.evidence.length}`, 'red');
          log(`   Mock IDs: ${mockEvidence.map((e: any) => e.video_id).join(', ')}`, 'red');
        } else {
          log(`   ✅ All evidence is real`, 'green');
        }
      } else {
        log(`   ⚠️  No evidence provided`, 'yellow');
      }
    }
    
    // Save full debug log
    const debugLog = {
      videoId,
      totalTime,
      events,
      result,
      toolCallCount: toolCalls.length,
      mockDataFound: toolCalls.some(tc => {
        const resultStr = JSON.stringify(tc.result || {});
        return resultStr.includes('mock-') || resultStr.includes('rb-00');
      })
    };
    
    const logPath = `/tmp/agentic-debug-${Date.now()}.json`;
    fs.writeFileSync(logPath, JSON.stringify(debugLog, null, 2));
    log(`\n   Debug log saved to: ${logPath}`, 'cyan');
    
  } catch (error: any) {
    log(`\n   ❌ EXECUTION FAILED: ${error.message}`, 'red');
    console.error(error);
  }
  
  // 5. Check OpenAI configuration
  log('\n\n5. OpenAI Configuration Check:', 'cyan');
  const { isOpenAIConfigured } = await import('../lib/agentic/openai-integration');
  
  const openaiConfigured = isOpenAIConfigured();
  log(`   OpenAI configured: ${openaiConfigured ? '✅' : '❌'}`, openaiConfigured ? 'green' : 'red');
  log(`   API Key present: ${!!process.env.OPENAI_API_KEY ? '✅' : '❌'}`, !!process.env.OPENAI_API_KEY ? 'green' : 'red');
  
  // 6. Check tool executor
  log('\n6. Tool Executor Check:', 'cyan');
  const { executeToolWithCache } = await import('../lib/agentic/tool-executor');
  const { getToolRegistry } = await import('../lib/orchestrator/tool-registry');
  
  const registry = getToolRegistry();
  const searchTool = registry.get('search_titles');
  
  if (searchTool) {
    try {
      const testResult = await executeToolWithCache(
        searchTool,
        { query: 'test', limit: 3 },
        {
          sessionId: 'test',
          requestId: 'test',
          mode: 'agentic',
          userId: 'test'
        },
        false
      );
      
      const hasResults = testResult && !testResult.error;
      log(`   Direct tool execution: ${hasResults ? '✅ Works' : '❌ Failed'}`, hasResults ? 'green' : 'red');
      
      if (testResult?.results) {
        log(`   Results returned: ${testResult.results.length}`, 'green');
      }
      
    } catch (error: any) {
      log(`   Direct tool execution failed: ${error.message}`, 'red');
    }
  }
}

// Run debug
debugAgenticExecution().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});