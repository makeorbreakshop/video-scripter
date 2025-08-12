#!/usr/bin/env npx tsx
/**
 * FOCUSED TEST: Why aren't tools executing with real data?
 */

import dotenv from 'dotenv';
import path from 'path';

// Load from .env (not .env.local)
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

async function testDirectToolExecution() {
  log('\n🔍 TESTING DIRECT TOOL EXECUTION\n', 'bright');
  
  // 1. Check environment
  log('1. Environment Variables:', 'cyan');
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasPinecone = !!process.env.PINECONE_API_KEY;
  const hasSupabase = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  log(`   OPENAI_API_KEY: ${hasOpenAI ? '✅' : '❌'} ${process.env.OPENAI_API_KEY?.substring(0, 10) || 'MISSING'}...`, hasOpenAI ? 'green' : 'red');
  log(`   PINECONE_API_KEY: ${hasPinecone ? '✅' : '❌'} ${process.env.PINECONE_API_KEY?.substring(0, 10) || 'MISSING'}...`, hasPinecone ? 'green' : 'red');
  log(`   SUPABASE_SERVICE_ROLE_KEY: ${hasSupabase ? '✅' : '❌'} ${process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0, 10) || 'MISSING'}...`, hasSupabase ? 'green' : 'red');
  
  // 2. Test tool executor directly
  log('\n2. Testing Tool Executor:', 'cyan');
  try {
    const toolExecutor = await import('../lib/agentic/tool-executor');
    log('   Tool executor module loaded ✅', 'green');
    
    // Check if it has the right functions
    const hasExecute = typeof toolExecutor.executeToolWithCache === 'function';
    log(`   executeToolWithCache function: ${hasExecute ? '✅' : '❌'}`, hasExecute ? 'green' : 'red');
    
    if (hasExecute) {
      // Try to execute a simple tool
      log('\n3. Executing search_titles tool:', 'cyan');
      const result = await toolExecutor.executeToolWithCache('search_titles', {
        query: 'satisfying',
        limit: 5
      });
      
      log(`   Result type: ${typeof result}`, 'yellow');
      log(`   Has error: ${!!result?.error}`, result?.error ? 'red' : 'green');
      log(`   Has results: ${!!result?.results}`, result?.results ? 'green' : 'red');
      
      if (result?.results) {
        log(`   Number of results: ${result.results.length}`, 'green');
        if (result.results.length > 0) {
          const firstId = result.results[0].video_id;
          const isMock = firstId.startsWith('mock-') || firstId.startsWith('rb-');
          log(`   First video ID: ${firstId}`, isMock ? 'red' : 'green');
          log(`   Is mock data: ${isMock ? '❌ YES' : '✅ NO'}`, isMock ? 'red' : 'green');
        }
      }
      
      if (result?.error) {
        log(`   Error: ${result.error}`, 'red');
      }
    }
    
  } catch (error: any) {
    log(`   Failed to load tool executor: ${error.message}`, 'red');
  }
  
  // 3. Check the tool executor source
  log('\n4. Analyzing tool-executor.ts:', 'cyan');
  const fs = await import('fs');
  const executorPath = path.join(process.cwd(), 'lib/agentic/tool-executor.ts');
  
  if (fs.existsSync(executorPath)) {
    const content = fs.readFileSync(executorPath, 'utf-8');
    
    // Check for mock returns
    const hasMockReturns = content.includes('mock-') || content.includes('rb-00');
    const hasRealFetch = content.includes('fetch(') && content.includes('/api/tools/');
    const hasConsoleLog = content.includes('console.log');
    
    log(`   Has mock data returns: ${hasMockReturns ? '❌ YES' : '✅ NO'}`, hasMockReturns ? 'red' : 'green');
    log(`   Has real fetch calls: ${hasRealFetch ? '✅ YES' : '❌ NO'}`, hasRealFetch ? 'green' : 'red');
    log(`   Has console.log for debugging: ${hasConsoleLog ? '✅ YES' : '❌ NO'}`, hasConsoleLog ? 'green' : 'red');
    
    if (hasMockReturns) {
      // Find mock return lines
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes('mock-') || line.includes('rb-00')) {
          log(`   Line ${idx + 1}: ${line.trim()}`, 'red');
        }
      });
    }
  }
  
  // 4. Test Pinecone directly
  log('\n5. Testing Pinecone Directly:', 'cyan');
  try {
    const { Pinecone } = await import('@pinecone-database/pinecone');
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!
    });
    
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    // Generate embedding
    log('   Generating embedding with OpenAI...', 'yellow');
    const openaiResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: 'satisfying content',
        dimensions: 512
      })
    });
    
    const embedData = await openaiResponse.json();
    
    if (embedData.data?.[0]?.embedding) {
      log('   Embedding generated ✅', 'green');
      
      // Search Pinecone
      log('   Searching Pinecone...', 'yellow');
      const searchResult = await index.query({
        vector: embedData.data[0].embedding,
        topK: 5,
        includeMetadata: true
      });
      
      log(`   Pinecone returned ${searchResult.matches?.length || 0} matches`, 'green');
      if (searchResult.matches && searchResult.matches.length > 0) {
        const firstMatch = searchResult.matches[0];
        log(`   First match: ${firstMatch.id} (score: ${firstMatch.score})`, 'green');
        log(`   Is real video ID: ${!firstMatch.id.startsWith('mock-') && !firstMatch.id.startsWith('rb-') ? '✅' : '❌'}`, 'green');
      }
    } else {
      log(`   Failed to generate embedding: ${JSON.stringify(embedData.error)}`, 'red');
    }
    
  } catch (error: any) {
    log(`   Pinecone test failed: ${error.message}`, 'red');
  }
  
  // 5. Test the orchestrator's tool calls
  log('\n6. Checking Orchestrator Tool Calls:', 'cyan');
  const orchestratorPath = path.join(process.cwd(), 'lib/agentic/orchestrator/idea-heist-agent.ts');
  
  if (fs.existsSync(orchestratorPath)) {
    const content = fs.readFileSync(orchestratorPath, 'utf-8');
    
    // Check how tools are called
    const usesToolExecutor = content.includes('executeToolWithCache');
    const hasToolHandling = content.includes('handleToolCalls');
    const returnsMockData = content.includes('generateMockEvidence');
    
    log(`   Uses executeToolWithCache: ${usesToolExecutor ? '✅ YES' : '❌ NO'}`, usesToolExecutor ? 'green' : 'red');
    log(`   Has handleToolCalls: ${hasToolHandling ? '✅ YES' : '❌ NO'}`, hasToolHandling ? 'green' : 'red');  
    log(`   Returns mock data: ${returnsMockData ? '❌ YES' : '✅ NO'}`, returnsMockData ? 'red' : 'green');
    
    if (returnsMockData) {
      // Find where mock data is generated
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes('generateMockEvidence') || line.includes('rb-00') || line.includes('mock-')) {
          log(`   Line ${idx + 1}: ${line.trim().substring(0, 100)}...`, 'red');
        }
      });
    }
  }
}

// Run test
testDirectToolExecution().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});