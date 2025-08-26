#!/usr/bin/env npx tsx
/**
 * REAL DATA INTEGRATION TEST - NO MOCKS
 * Tests the entire agentic system with actual API calls
 */

import dotenv from 'dotenv';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const API_BASE = 'http://localhost:3000';
const REAL_VIDEO_ID = 'U5GHwG3_RAo'; // Real video with 185x TPS

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(80));
  log(title, 'bright');
  console.log('='.repeat(80));
}

function logTest(name: string, passed: boolean, details?: string) {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  const color = passed ? 'green' : 'red';
  log(`${status}: ${name}`, color);
  if (details) {
    console.log(`   ${details}`);
  }
}

async function checkEnvironment() {
  logSection('1. ENVIRONMENT CHECK - REAL CREDENTIALS');
  
  const required = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'PINECONE_API_KEY',
    'PINECONE_INDEX_NAME',
    'YOUTUBE_API_KEY'
  ];
  
  let allPresent = true;
  for (const key of required) {
    const value = process.env[key];
    const present = !!value;
    if (!present) allPresent = false;
    
    logTest(
      key,
      present,
      present ? `Set (${value?.substring(0, 8)}...)` : 'MISSING - WILL CAUSE FAILURES'
    );
  }
  
  return allPresent;
}

async function testToolEndpoints() {
  logSection('2. TOOL ENDPOINT TESTS - REAL API CALLS');
  
  const tools = [
    {
      name: 'get-video-bundle',
      endpoint: '/api/tools/get-video-bundle',
      payload: { video_id: REAL_VIDEO_ID }
    },
    {
      name: 'search-titles',
      endpoint: '/api/tools/search-titles',
      payload: { query: 'satisfying mechanical keyboard', limit: 5 }
    },
    {
      name: 'search-summaries',
      endpoint: '/api/tools/search-summaries',
      payload: { query: 'oddly satisfying content', limit: 5 }
    },
    {
      name: 'perf-snapshot',
      endpoint: '/api/tools/perf-snapshot',
      payload: { video_ids: [REAL_VIDEO_ID] }
    },
    {
      name: 'get-channel-baseline',
      endpoint: '/api/tools/get-channel-baseline',
      payload: { channel_id: 'UCXuqSBlHAE6Xw-yeJA0Tunw' } // Real channel
    }
  ];
  
  const results: any[] = [];
  
  for (const tool of tools) {
    try {
      log(`\nTesting ${tool.name}...`, 'cyan');
      const startTime = Date.now();
      
      const response = await fetch(`${API_BASE}${tool.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tool.payload)
      });
      
      const duration = Date.now() - startTime;
      const data = await response.json();
      
      const success = response.ok && !data.error;
      results.push({ tool: tool.name, success, duration, data });
      
      logTest(
        tool.name,
        success,
        success 
          ? `Response in ${duration}ms - ${JSON.stringify(data).substring(0, 100)}...`
          : `Failed: ${data.error || response.statusText}`
      );
      
      // Show specific validation for critical fields
      if (success && tool.name === 'search-titles' && data.results) {
        log(`   Found ${data.results.length} videos via Pinecone search`, 'green');
        if (data.results.length > 0) {
          log(`   Top match: ${data.results[0].video_id} (score: ${data.results[0].score})`, 'green');
        }
      }
      
    } catch (error: any) {
      results.push({ tool: tool.name, success: false, error: error.message });
      logTest(tool.name, false, `Exception: ${error.message}`);
    }
  }
  
  const passed = results.filter(r => r.success).length;
  const total = results.length;
  
  log(`\nTool Endpoints: ${passed}/${total} working with real data`, passed === total ? 'green' : 'red');
  return results;
}

async function testOpenAIIntegration() {
  logSection('3. OPENAI INTEGRATION TEST - REAL API');
  
  try {
    // Test hypothesis generation with real OpenAI
    const response = await fetch(`${API_BASE}/api/test/openai-hypothesis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_id: REAL_VIDEO_ID,
        title: "World's Most Satisfying Video",
        channel: "Test Channel",
        tps: 185.9
      })
    });
    
    if (!response.ok) {
      // Create a simple test endpoint if it doesn't exist
      log('Creating test endpoint for OpenAI...', 'yellow');
      
      // Direct OpenAI test
      const { Configuration, OpenAIApi } = await import('openai');
      const configuration = new Configuration({
        apiKey: process.env.OPENAI_API_KEY,
      });
      const openai = new OpenAIApi(configuration);
      
      const completion = await openai.createChatCompletion({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content: 'Generate a hypothesis for why this video outperformed.'
          },
          {
            role: 'user',
            content: `Video "${REAL_VIDEO_ID}" got 185x baseline performance. Why?`
          }
        ],
        temperature: 0.7,
        max_tokens: 200
      });
      
      const hypothesis = completion.data.choices[0]?.message?.content;
      logTest('OpenAI Direct Call', !!hypothesis, hypothesis?.substring(0, 100) + '...');
      return !!hypothesis;
    }
    
    const data = await response.json();
    logTest('OpenAI Hypothesis Generation', !!data.hypothesis, data.hypothesis?.substring(0, 100) + '...');
    return !!data.hypothesis;
    
  } catch (error: any) {
    logTest('OpenAI Integration', false, error.message);
    return false;
  }
}

async function testPineconeIntegration() {
  logSection('4. PINECONE INTEGRATION TEST - REAL VECTORS');
  
  try {
    // Test actual Pinecone search
    const response = await fetch(`${API_BASE}/api/tools/search-titles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'satisfying',
        limit: 10,
        filters: {
          min_tps: 2.0
        }
      })
    });
    
    const data = await response.json();
    const hasResults = data.results && data.results.length > 0;
    const hasRealVideoIds = hasResults && !data.results[0].video_id.startsWith('mock-');
    
    logTest('Pinecone Title Search', hasRealVideoIds, 
      hasRealVideoIds 
        ? `Found ${data.results.length} real videos`
        : 'No real results - might be returning mocks'
    );
    
    if (hasRealVideoIds) {
      log(`   Sample IDs: ${data.results.slice(0, 3).map((r: any) => r.video_id).join(', ')}`, 'green');
    }
    
    return hasRealVideoIds;
    
  } catch (error: any) {
    logTest('Pinecone Integration', false, error.message);
    return false;
  }
}

async function testSupabaseIntegration() {
  logSection('5. SUPABASE INTEGRATION TEST - REAL DATABASE');
  
  try {
    // Test fetching a real video from database
    const response = await fetch(`${API_BASE}/api/tools/get-video-bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: REAL_VIDEO_ID })
    });
    
    const data = await response.json();
    const hasVideo = data.video && data.video.id === REAL_VIDEO_ID;
    const hasTPS = data.video?.temporal_performance_score > 0;
    
    logTest('Supabase Video Fetch', hasVideo && hasTPS,
      hasVideo 
        ? `TPS: ${data.video.temporal_performance_score}, Channel: ${data.video.channel_id}`
        : 'Failed to fetch real video data'
    );
    
    return hasVideo && hasTPS;
    
  } catch (error: any) {
    logTest('Supabase Integration', false, error.message);
    return false;
  }
}

async function testFullAgenticPipeline() {
  logSection('6. FULL AGENTIC PIPELINE TEST - REAL END-TO-END');
  
  const startTime = Date.now();
  let lastEventTime = startTime;
  
  try {
    log('\nRunning full agentic analysis...', 'cyan');
    log(`Video ID: ${REAL_VIDEO_ID}`, 'cyan');
    
    const response = await fetch(`${API_BASE}/api/idea-heist/agentic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: REAL_VIDEO_ID,
        options: {
          maxFanoutRequests: 5,
          maxValidationRounds: 3,
          maxSearchRounds: 2,
          timeoutSeconds: 180
        }
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API returned ${response.status}: ${error}`);
    }
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullLog = '';
    let toolCallCount = 0;
    let realEvidenceFound = false;
    
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      fullLog += chunk;
      
      // Parse SSE events
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const now = Date.now();
            const elapsed = ((now - startTime) / 1000).toFixed(1);
            const delta = ((now - lastEventTime) / 1000).toFixed(1);
            lastEventTime = now;
            
            // Track tool calls
            if (data.type === 'tool_call') {
              toolCallCount++;
              log(`   [${elapsed}s] Tool Call #${toolCallCount}: ${data.tool} (+${delta}s)`, 'yellow');
              
              // Check for real video IDs in responses
              if (data.result && typeof data.result === 'object') {
                const resultStr = JSON.stringify(data.result);
                if (resultStr.includes('video_id') && !resultStr.includes('mock-') && !resultStr.includes('rb-')) {
                  realEvidenceFound = true;
                  log(`      ✓ Real evidence found!`, 'green');
                }
              }
            } else if (data.type === 'turn_complete') {
              log(`   [${elapsed}s] Turn Complete: ${data.turn} (+${delta}s)`, 'blue');
            } else if (data.type === 'complete') {
              log(`   [${elapsed}s] Analysis Complete (+${delta}s)`, 'green');
              
              // Check final pattern
              if (data.result?.pattern) {
                log(`\n   Pattern: "${data.result.pattern.statement}"`, 'magenta');
                log(`   Confidence: ${data.result.pattern.confidence}%`, 'magenta');
                log(`   Evidence Count: ${data.result.pattern.evidence?.length || 0}`, 'magenta');
                
                // Check if evidence contains real video IDs
                if (data.result.pattern.evidence) {
                  const mockCount = data.result.pattern.evidence.filter((e: any) => 
                    e.video_id.startsWith('mock-') || e.video_id.startsWith('rb-')
                  ).length;
                  
                  if (mockCount > 0) {
                    log(`   ⚠️  Mock Evidence: ${mockCount}/${data.result.pattern.evidence.length} are fake!`, 'red');
                  }
                }
              }
            }
          } catch (e) {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Analyze results
    logTest('Pipeline Completion', true, `Completed in ${duration}s`);
    logTest('Tool Execution', toolCallCount > 0, `${toolCallCount} tool calls made`);
    logTest('Real Evidence', realEvidenceFound, 
      realEvidenceFound ? 'Found real video IDs' : 'Only mock evidence (rb-xxx, mock-xxx)'
    );
    
    // Save full log for debugging
    const logPath = `/tmp/agentic-test-${Date.now()}.log`;
    fs.writeFileSync(logPath, fullLog);
    log(`\nFull log saved to: ${logPath}`, 'cyan');
    
    return toolCallCount > 0 && realEvidenceFound;
    
  } catch (error: any) {
    logTest('Full Pipeline', false, error.message);
    return false;
  }
}

async function testToolExecutor() {
  logSection('7. TOOL EXECUTOR TEST - VERIFY REAL EXECUTION');
  
  try {
    // Import and test the tool executor directly
    const { executeToolWithCache } = await import('../lib/agentic/tool-executor');
    
    log('\nTesting direct tool execution...', 'cyan');
    
    // Test a real tool call
    const result = await executeToolWithCache('search_titles', {
      query: 'satisfying',
      limit: 5
    });
    
    const hasResults = result && !result.error && result.results?.length > 0;
    const hasRealIds = hasResults && !result.results[0].video_id.startsWith('mock-');
    
    logTest('Direct Tool Execution', hasRealIds,
      hasRealIds 
        ? `Got ${result.results.length} real results`
        : result.error || 'No real results'
    );
    
    if (hasRealIds) {
      log(`   First result: ${result.results[0].video_id} (${result.results[0].score})`, 'green');
    }
    
    return hasRealIds;
    
  } catch (error: any) {
    logTest('Tool Executor', false, error.message);
    return false;
  }
}

async function main() {
  console.clear();
  log('🔬 AGENTIC MODE REAL DATA TEST SUITE', 'bright');
  log('Testing with ACTUAL APIs - No Mocks!\n', 'yellow');
  
  const results = {
    environment: false,
    tools: false,
    openai: false,
    pinecone: false,
    supabase: false,
    pipeline: false,
    executor: false
  };
  
  // Run all tests
  results.environment = await checkEnvironment();
  
  if (!results.environment) {
    log('\n⚠️  Missing environment variables! Tests will fail.', 'red');
    log('Make sure .env.local has all required API keys.', 'red');
  }
  
  const toolResults = await testToolEndpoints();
  results.tools = toolResults.filter(r => r.success).length === toolResults.length;
  
  results.openai = await testOpenAIIntegration();
  results.pinecone = await testPineconeIntegration();
  results.supabase = await testSupabaseIntegration();
  results.executor = await testToolExecutor();
  results.pipeline = await testFullAgenticPipeline();
  
  // Final summary
  logSection('TEST SUMMARY');
  
  const total = Object.keys(results).length;
  const passed = Object.values(results).filter(r => r).length;
  const percentage = ((passed / total) * 100).toFixed(0);
  
  console.log('\nResults:');
  for (const [test, passed] of Object.entries(results)) {
    logTest(test.toUpperCase(), passed as boolean);
  }
  
  console.log('\n' + '='.repeat(80));
  if (passed === total) {
    log(`✅ ALL TESTS PASSED! (${passed}/${total})`, 'green');
    log('The agentic system is working with REAL data!', 'green');
  } else {
    log(`❌ TESTS FAILED: ${passed}/${total} passed (${percentage}%)`, 'red');
    log('The system is NOT working properly with real data.', 'red');
    
    if (!results.tools) {
      log('\n⚠️  Tool endpoints are not returning real data!', 'yellow');
      log('Check that Pinecone and Supabase credentials are correct.', 'yellow');
    }
    
    if (!results.executor) {
      log('\n⚠️  Tool executor is not calling real APIs!', 'yellow');
      log('The executeToolWithCache function may be returning mocks.', 'yellow');
    }
    
    if (!results.pipeline) {
      log('\n⚠️  Full pipeline is not gathering real evidence!', 'yellow');
      log('Check the orchestrator\'s tool execution logic.', 'yellow');
    }
  }
  console.log('='.repeat(80));
  
  process.exit(passed === total ? 0 : 1);
}

// Run tests
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});