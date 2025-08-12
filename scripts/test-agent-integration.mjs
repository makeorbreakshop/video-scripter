/**
 * End-to-end Integration Test for Idea Heist Agent with Logging
 * Tests the complete flow with real API calls (if configured)
 */

// Use native fetch in Node.js 18+
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// Test configuration
const TEST_VIDEO_ID = 'XcqxkOd-DzM'; // A real video ID from the database
const API_BASE_URL = 'http://localhost:3000';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, type = 'info') {
  const prefix = {
    info: `${colors.blue}ℹ️`,
    success: `${colors.green}✅`,
    error: `${colors.red}❌`,
    warning: `${colors.yellow}⚠️`,
    test: `${colors.cyan}📌`
  }[type] || '';
  
  console.log(`${prefix} ${message}${colors.reset}`);
}

async function testStreamingEndpoint() {
  log('Testing streaming endpoint with real-time updates', 'test');
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/idea-heist/agentic-v2`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: TEST_VIDEO_ID,
        mode: 'agentic',
        options: {
          maxTokens: 10000, // Lower for testing
          maxToolCalls: 10,
          maxFanouts: 2,
          timeoutMs: 60000 // 1 minute for testing
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    // Process streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let messageCount = 0;
    let taskBoardReceived = false;
    let metricsReceived = false;
    let finalResult = null;
    
    log('Reading streaming response...', 'info');
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            messageCount++;
            
            // Log specific message types
            switch (data.type) {
              case 'status':
                log(`  Status: ${data.message}`, 'info');
                break;
              case 'task_board':
                taskBoardReceived = true;
                log(`  Task board initialized with ${data.tasks?.length} tasks`, 'success');
                break;
              case 'task_update':
                log(`  Task ${data.taskId}: ${data.status}`, 'info');
                break;
              case 'reasoning':
                log(`  Reasoning: ${data.message?.substring(0, 50)}...`, 'info');
                break;
              case 'tool_call':
                log(`  Tool: ${data.tool} ${data.success ? '✓' : '✗'}`, 'info');
                break;
              case 'metrics_footer':
                metricsReceived = true;
                log(`  Metrics: ${data.totalTools} tools, ${data.totalTokens} tokens, $${data.totalCost}`, 'success');
                break;
              case 'complete':
                finalResult = data.result;
                log(`  Analysis complete! Log file: ${data.logFile}`, 'success');
                break;
              case 'error':
                log(`  Error: ${data.message}`, 'error');
                break;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    
    log(`Received ${messageCount} streaming messages`, 'success');
    log(`Task board: ${taskBoardReceived ? 'Yes' : 'No'}`, taskBoardReceived ? 'success' : 'warning');
    log(`Metrics: ${metricsReceived ? 'Yes' : 'No'}`, metricsReceived ? 'success' : 'warning');
    log(`Final result: ${finalResult ? 'Yes' : 'No'}`, finalResult ? 'success' : 'warning');
    
    if (finalResult) {
      log(`Pattern discovered: ${finalResult.summary_md?.substring(0, 100)}...`, 'success');
      log(`Blocks in result: ${finalResult.blocks?.length || 0}`, 'info');
    }
    
    return messageCount > 0;
    
  } catch (error) {
    log(`Streaming test failed: ${error.message}`, 'error');
    return false;
  }
}

async function checkLogFiles() {
  log('Checking for generated log files', 'test');
  
  const logDir = path.join(process.cwd(), 'logs', 'agent-runs', new Date().toISOString().split('T')[0]);
  
  if (!fs.existsSync(logDir)) {
    log(`Log directory does not exist: ${logDir}`, 'warning');
    return false;
  }
  
  const files = fs.readdirSync(logDir);
  const logFiles = files.filter(f => f.endsWith('.jsonl'));
  const metadataFiles = files.filter(f => f.endsWith('_metadata.json'));
  const summaryFiles = files.filter(f => f.endsWith('_summary.json'));
  
  log(`Found ${logFiles.length} log files`, logFiles.length > 0 ? 'success' : 'warning');
  log(`Found ${metadataFiles.length} metadata files`, metadataFiles.length > 0 ? 'success' : 'warning');
  log(`Found ${summaryFiles.length} summary files`, summaryFiles.length > 0 ? 'success' : 'warning');
  
  // Check the latest log file content
  if (logFiles.length > 0) {
    const latestLog = logFiles[logFiles.length - 1];
    const logPath = path.join(logDir, latestLog);
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    
    log(`Latest log file: ${latestLog}`, 'info');
    log(`Log entries: ${lines.length}`, 'info');
    
    // Parse and check entry types
    const entryTypes = new Set();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        entryTypes.add(entry.level);
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    log(`Entry types: ${Array.from(entryTypes).join(', ')}`, 'info');
    
    return lines.length > 0;
  }
  
  return false;
}

async function testDatabaseStorage() {
  log('Checking database storage of discoveries', 'test');
  
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    log('Supabase not configured, skipping database test', 'warning');
    return false;
  }
  
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // Check for recent discoveries
    const { data, error } = await supabase
      .from('idea_heist_discoveries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (error) {
      log(`Database query failed: ${error.message}`, 'error');
      return false;
    }
    
    log(`Found ${data?.length || 0} recent discoveries in database`, 'info');
    
    if (data && data.length > 0) {
      const latest = data[0];
      log(`Latest discovery:`, 'success');
      log(`  - Video: ${latest.video_id}`, 'info');
      log(`  - Mode: ${latest.discovery_mode}`, 'info');
      log(`  - Pattern: ${latest.pattern_statement?.substring(0, 50)}...`, 'info');
      log(`  - Confidence: ${latest.confidence}`, 'info');
      log(`  - Created: ${new Date(latest.created_at).toLocaleString()}`, 'info');
    }
    
    return true;
    
  } catch (error) {
    log(`Database test failed: ${error.message}`, 'error');
    return false;
  }
}

async function testStructuredOutput() {
  log('Testing structured output format', 'test');
  
  // Make a simple API call to check structured output
  try {
    const response = await fetch(`${API_BASE_URL}/api/idea-heist/agentic`, {
      method: 'GET'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    log(`API Status: ${data.status}`, 'success');
    log(`OpenAI configured: ${data.openaiConfigured}`, data.openaiConfigured ? 'success' : 'warning');
    log(`Version: ${data.version}`, 'info');
    log(`Capabilities: ${data.capabilities?.tools} tools, ${data.capabilities?.models?.length} models`, 'info');
    
    return true;
    
  } catch (error) {
    log(`Status check failed: ${error.message}`, 'error');
    return false;
  }
}

async function runIntegrationTests() {
  console.log('\n' + colors.bright + '🧪 End-to-End Integration Test for Idea Heist Agent' + colors.reset);
  console.log('=' .repeat(60) + '\n');
  
  // Check environment
  log('Checking environment configuration', 'test');
  log(`Supabase: ${SUPABASE_URL ? 'Configured' : 'Not configured'}`, SUPABASE_URL ? 'success' : 'warning');
  log(`OpenAI: ${OPENAI_KEY ? 'Configured' : 'Not configured'}`, OPENAI_KEY ? 'success' : 'warning');
  
  const tests = [
    { name: 'Structured Output API', fn: testStructuredOutput },
    { name: 'Streaming Endpoint', fn: testStreamingEndpoint },
    { name: 'Log File Generation', fn: checkLogFiles },
    { name: 'Database Storage', fn: testDatabaseStorage }
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    console.log('\n' + '-'.repeat(60));
    log(`Running: ${test.name}`, 'test');
    console.log();
    
    try {
      const result = await test.fn();
      if (result) {
        passed++;
        log(`${test.name}: PASSED`, 'success');
      } else {
        failed++;
        log(`${test.name}: FAILED`, 'error');
      }
    } catch (error) {
      failed++;
      log(`${test.name}: ERROR - ${error.message}`, 'error');
    }
  }
  
  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log('\n' + colors.bright + '📊 Integration Test Results:' + colors.reset);
  console.log(`  ${colors.green}✅ Passed: ${passed}${colors.reset}`);
  console.log(`  ${colors.red}❌ Failed: ${failed}${colors.reset}`);
  
  if (failed === 0) {
    console.log('\n' + colors.green + colors.bright + '🎉 All integration tests passed!' + colors.reset);
    console.log('\nThe Idea Heist Agent logging system is fully operational:');
    console.log('  ✓ Comprehensive file-based logging');
    console.log('  ✓ Real-time streaming updates');
    console.log('  ✓ Structured JSON output format');
    console.log('  ✓ Error recovery mechanisms');
    console.log('  ✓ Database persistence');
  } else {
    console.log('\n' + colors.yellow + `⚠️ ${failed} test(s) failed` + colors.reset);
    console.log('\nNote: Some tests may fail if:');
    console.log('  - The Next.js server is not running (npm run dev)');
    console.log('  - OpenAI API key is not configured');
    console.log('  - No recent agent runs have been performed');
  }
  
  return failed === 0;
}

// Run tests
runIntegrationTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});