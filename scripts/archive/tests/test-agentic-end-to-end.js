#!/usr/bin/env node

/**
 * COMPREHENSIVE END-TO-END TEST FOR AGENTIC MODE
 * Tests the complete flow from API call to database storage
 */

// Load environment variables
require('dotenv').config();

const https = require('https');

// Test configuration
const API_URL = 'http://localhost:3000/api/idea-heist/agentic';
const TEST_VIDEO_ID = '1lJJZ-KXj0I'; // A real video ID from your database

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const color = {
    'ERROR': colors.red,
    'SUCCESS': colors.green,
    'INFO': colors.blue,
    'WARN': colors.yellow,
    'TEST': colors.magenta,
    'RESULT': colors.cyan
  }[level] || colors.reset;
  
  console.log(`${color}[${timestamp}] [${level}] ${message}${colors.reset}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * Test 1: Basic API connectivity
 */
async function testAPIConnectivity() {
  log('TEST', 'Testing API connectivity...');
  
  return new Promise((resolve, reject) => {
    fetch(API_URL.replace('/agentic', '/agentic'), {
      method: 'GET'
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'ready') {
        log('SUCCESS', 'API is ready', data);
        resolve(true);
      } else {
        log('ERROR', 'API not ready', data);
        resolve(false);
      }
    })
    .catch(err => {
      log('ERROR', 'Failed to connect to API', err.message);
      resolve(false);
    });
  });
}

/**
 * Test 2: Test with minimal configuration
 */
async function testMinimalConfig() {
  log('TEST', 'Testing with minimal configuration...');
  
  const payload = {
    videoId: TEST_VIDEO_ID,
    mode: 'agentic'
  };
  
  return makeAPICall(payload, 'minimal config');
}

/**
 * Test 3: Test with production configuration
 */
async function testProductionConfig() {
  log('TEST', 'Testing with production configuration (3-minute timeout, high limits)...');
  
  const payload = {
    videoId: TEST_VIDEO_ID,
    mode: 'agentic',
    options: {
      maxTokens: 200000,
      maxToolCalls: 100,
      maxFanouts: 5,
      maxValidations: 20,
      maxDurationMs: 180000,
      timeoutMs: 180000
    }
  };
  
  return makeAPICall(payload, 'production config');
}

/**
 * Test 4: Test budget limits
 */
async function testBudgetLimits() {
  log('TEST', 'Testing budget limit enforcement...');
  
  const payload = {
    videoId: TEST_VIDEO_ID,
    mode: 'agentic',
    options: {
      maxTokens: 100,      // Very low to trigger budget exceeded
      maxToolCalls: 1,
      maxFanouts: 1,
      maxValidations: 1,
      maxDurationMs: 5000, // 5 seconds
      timeoutMs: 5000
    }
  };
  
  return makeAPICall(payload, 'budget limits');
}

/**
 * Test 5: Test fallback mechanism
 */
async function testFallback() {
  log('TEST', 'Testing fallback to classic mode...');
  
  const payload = {
    videoId: TEST_VIDEO_ID,
    mode: 'agentic',
    options: {
      fallbackToClassic: true,
      maxDurationMs: 1000, // 1 second - should trigger timeout and fallback
      timeoutMs: 1000
    }
  };
  
  return makeAPICall(payload, 'fallback mechanism');
}

/**
 * Test 6: Verify database storage
 */
async function testDatabaseStorage(videoId) {
  log('TEST', 'Verifying database storage...');
  
  // Check if pattern was stored
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  const { data, error } = await supabase
    .from('patterns')
    .select('*')
    .eq('video_id', videoId)
    .eq('pattern_type', 'agentic')
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (error) {
    log('ERROR', 'Failed to query database', error);
    return false;
  }
  
  if (data && data.length > 0) {
    log('SUCCESS', 'Pattern stored in database', data[0]);
    return true;
  } else {
    log('WARN', 'No pattern found in database');
    return false;
  }
}

/**
 * Make API call helper
 */
async function makeAPICall(payload, testName) {
  const startTime = Date.now();
  
  log('INFO', `Starting ${testName} test...`, payload);
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    const duration = Date.now() - startTime;
    
    if (response.ok && data.success) {
      log('SUCCESS', `${testName} completed in ${duration}ms`, {
        mode: data.mode,
        fallbackUsed: data.fallbackUsed,
        pattern: data.pattern,
        metrics: data.metrics,
        budgetUsage: data.budgetUsage
      });
      
      // Verify pattern structure
      if (data.pattern) {
        const hasRequiredFields = 
          data.pattern.statement && 
          typeof data.pattern.confidence === 'number';
        
        if (!hasRequiredFields) {
          log('WARN', 'Pattern missing required fields', data.pattern);
        }
      }
      
      return true;
    } else {
      log('ERROR', `${testName} failed after ${duration}ms`, {
        status: response.status,
        error: data.error,
        details: data.details
      });
      return false;
    }
  } catch (error) {
    log('ERROR', `${testName} threw exception`, error.message);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(80));
  log('INFO', 'STARTING COMPREHENSIVE AGENTIC MODE TESTS');
  console.log('='.repeat(80) + '\n');
  
  const results = {
    connectivity: false,
    minimal: false,
    production: false,
    budgetLimits: false,
    fallback: false,
    database: false
  };
  
  // Test 1: API Connectivity
  results.connectivity = await testAPIConnectivity();
  if (!results.connectivity) {
    log('ERROR', 'API not accessible. Is the server running?');
    log('INFO', 'Start the server with: npm run dev');
    process.exit(1);
  }
  
  // Add delay between tests
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 2: Minimal config
  results.minimal = await testMinimalConfig();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 3: Production config
  results.production = await testProductionConfig();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 4: Budget limits
  results.budgetLimits = await testBudgetLimits();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 5: Fallback
  results.fallback = await testFallback();
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 6: Database storage
  results.database = await testDatabaseStorage(TEST_VIDEO_ID);
  
  // Summary
  console.log('\n' + '='.repeat(80));
  log('RESULT', 'TEST SUMMARY');
  console.log('='.repeat(80));
  
  let passed = 0;
  let failed = 0;
  
  for (const [test, result] of Object.entries(results)) {
    if (result) {
      log('SUCCESS', `✓ ${test}`);
      passed++;
    } else {
      log('ERROR', `✗ ${test}`);
      failed++;
    }
  }
  
  console.log('\n' + '-'.repeat(80));
  log('RESULT', `Tests Passed: ${passed}/${passed + failed}`);
  
  if (failed > 0) {
    log('ERROR', 'Some tests failed. Check the logs above for details.');
    process.exit(1);
  } else {
    log('SUCCESS', 'All tests passed! Agentic mode is working correctly.');
  }
}

// Check for required environment variables
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  log('ERROR', 'Missing required environment variables');
  log('INFO', 'Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set');
  process.exit(1);
}

// Run tests
runAllTests().catch(err => {
  log('ERROR', 'Test suite failed', err);
  process.exit(1);
});