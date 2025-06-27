#!/usr/bin/env node

/**
 * YouTube Analytics API Test Script
 * Similar to pytest - runs local tests to debug API issues
 */

// Color output for better readability
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Mock access token for testing (you'll need to replace this)
const ACCESS_TOKEN = process.env.YOUTUBE_ACCESS_TOKEN || 'YOUR_ACCESS_TOKEN_HERE';

async function testYouTubeAnalyticsAPI() {
  log('\n=== Testing YouTube Analytics API Queries ===', 'blue');
  
  const baseUrl = 'https://youtubeanalytics.googleapis.com/v2';
  
  if (ACCESS_TOKEN === 'YOUR_ACCESS_TOKEN_HERE') {
    log('❌ No access token provided. Set YOUTUBE_ACCESS_TOKEN environment variable', 'red');
    log('💡 Get token from browser dev tools after OAuth flow', 'yellow');
    return;
  }
  
  // Test 1: Basic channel query
  log('\n--- Test 1: Basic Channel Query ---', 'yellow');
  try {
    const url1 = new URL(`${baseUrl}/reports`);
    url1.searchParams.append('ids', 'channel==MINE');
    url1.searchParams.append('startDate', '2025-06-19');
    url1.searchParams.append('endDate', '2025-06-26');
    url1.searchParams.append('metrics', 'views');
    
    log(`🔍 Testing: ${url1.toString()}`);
    
    const response1 = await fetch(url1.toString(), {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response1.ok) {
      const data1 = await response1.json();
      log(`✓ Basic channel query: SUCCESS (${data1.rows?.length || 0} rows)`, 'green');
    } else {
      const error1 = await response1.text();
      log(`✗ Basic channel query: FAILED (${response1.status})`, 'red');
      log(`  Error: ${error1}`, 'red');
    }
  } catch (error) {
    log(`✗ Basic channel query: ERROR - ${error.message}`, 'red');
  }
  
  // Test 2: Video dimension query
  log('\n--- Test 2: Video Dimension Query ---', 'yellow');
  try {
    const url2 = new URL(`${baseUrl}/reports`);
    url2.searchParams.append('ids', 'channel==MINE');
    url2.searchParams.append('startDate', '2025-06-19');
    url2.searchParams.append('endDate', '2025-06-26');
    url2.searchParams.append('metrics', 'views');
    url2.searchParams.append('dimensions', 'video');
    
    log(`🔍 Testing: ${url2.toString()}`);
    
    const response2 = await fetch(url2.toString(), {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response2.ok) {
      const data2 = await response2.json();
      log(`✓ Video dimension query: SUCCESS (${data2.rows?.length || 0} rows)`, 'green');
      if (data2.rows && data2.rows.length > 0) {
        log(`  Sample videos found: ${Math.min(3, data2.rows.length)}`, 'green');
      }
    } else {
      const error2 = await response2.text();
      log(`✗ Video dimension query: FAILED (${response2.status})`, 'red');
      log(`  Error: ${error2}`, 'red');
    }
  } catch (error) {
    log(`✗ Video dimension query: ERROR - ${error.message}`, 'red');
  }
  
  // Test 3: Video + Day dimensions (our failing query)
  log('\n--- Test 3: Video + Day Dimensions (Current Failing Query) ---', 'yellow');
  try {
    const url3 = new URL(`${baseUrl}/reports`);
    url3.searchParams.append('ids', 'channel==MINE');
    url3.searchParams.append('startDate', '2025-06-19');
    url3.searchParams.append('endDate', '2025-06-26');
    url3.searchParams.append('metrics', 'views,likes,comments');
    url3.searchParams.append('dimensions', 'video,day');
    url3.searchParams.append('sort', 'day');
    
    log(`🔍 Testing: ${url3.toString()}`);
    
    const response3 = await fetch(url3.toString(), {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response3.ok) {
      const data3 = await response3.json();
      log(`✓ Video + Day dimensions: SUCCESS (${data3.rows?.length || 0} rows)`, 'green');
      if (data3.rows && data3.rows.length > 0) {
        log(`  Sample row: ${JSON.stringify(data3.rows[0])}`, 'green');
      }
    } else {
      const error3 = await response3.text();
      log(`✗ Video + Day dimensions: FAILED (${response3.status})`, 'red');
      log(`  Error: ${error3}`, 'red');
    }
  } catch (error) {
    log(`✗ Video + Day dimensions: ERROR - ${error.message}`, 'red');
  }
  
  // Test 4: Our exact failing query
  log('\n--- Test 4: Exact Failing Query from Code ---', 'yellow');
  try {
    const metrics = [
      'views',
      'likes', 
      'comments',
      'shares',
      'subscribersGained',
      'estimatedMinutesWatched',
      'averageViewDuration',
      'averageViewPercentage'
    ];
    
    const url4 = new URL(`${baseUrl}/reports`);
    url4.searchParams.append('ids', 'channel==MINE');
    url4.searchParams.append('startDate', '2025-06-19');
    url4.searchParams.append('endDate', '2025-06-26');
    url4.searchParams.append('metrics', metrics.join(','));
    url4.searchParams.append('dimensions', 'video,day');
    url4.searchParams.append('sort', 'day');
    
    log(`🔍 Testing exact failing query: ${url4.toString()}`);
    
    const response4 = await fetch(url4.toString(), {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response4.ok) {
      const data4 = await response4.json();
      log(`✓ Exact failing query: SUCCESS (${data4.rows?.length || 0} rows)`, 'green');
      if (data4.rows && data4.rows.length > 0) {
        log(`  Sample row: ${JSON.stringify(data4.rows[0])}`, 'green');
      }
    } else {
      const error4 = await response4.text();
      log(`✗ Exact failing query: FAILED (${response4.status})`, 'red');
      log(`  Error: ${error4}`, 'red');
    }
  } catch (error) {
    log(`✗ Exact failing query: ERROR - ${error.message}`, 'red');
  }
  
  // Test 5: Try without some metrics
  log('\n--- Test 5: Simplified Metrics ---', 'yellow');
  try {
    const simpleMetrics = ['views', 'likes', 'comments'];
    
    const url5 = new URL(`${baseUrl}/reports`);
    url5.searchParams.append('ids', 'channel==MINE');
    url5.searchParams.append('startDate', '2025-06-19');
    url5.searchParams.append('endDate', '2025-06-26');
    url5.searchParams.append('metrics', simpleMetrics.join(','));
    url5.searchParams.append('dimensions', 'video,day');
    url5.searchParams.append('sort', 'day');
    
    log(`🔍 Testing simplified metrics: ${url5.toString()}`);
    
    const response5 = await fetch(url5.toString(), {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response5.ok) {
      const data5 = await response5.json();
      log(`✓ Simplified metrics: SUCCESS (${data5.rows?.length || 0} rows)`, 'green');
    } else {
      const error5 = await response5.text();
      log(`✗ Simplified metrics: FAILED (${response5.status})`, 'red');
      log(`  Error: ${error5}`, 'red');
    }
  } catch (error) {
    log(`✗ Simplified metrics: ERROR - ${error.message}`, 'red');
  }
  
  // Test 6: Individual metric testing
  log('\n--- Test 6: Individual Metric Testing ---', 'yellow');
  const metricsToTest = [
    'views',
    'likes', 
    'comments',
    'shares',
    'subscribersGained',
    'estimatedMinutesWatched',
    'averageViewDuration',
    'averageViewPercentage'
  ];
  
  for (const metric of metricsToTest) {
    try {
      const url6 = new URL(`${baseUrl}/reports`);
      url6.searchParams.append('ids', 'channel==MINE');
      url6.searchParams.append('startDate', '2025-06-19');
      url6.searchParams.append('endDate', '2025-06-26');
      url6.searchParams.append('metrics', metric);
      url6.searchParams.append('dimensions', 'video,day');
      url6.searchParams.append('sort', 'day');
      
      const response6 = await fetch(url6.toString(), {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response6.ok) {
        const data6 = await response6.json();
        log(`  ✓ ${metric}: SUCCESS (${data6.rows?.length || 0} rows)`, 'green');
      } else {
        const error6 = await response6.text();
        log(`  ✗ ${metric}: FAILED`, 'red');
        // Only show first error to avoid spam
        if (metric === 'views') {
          log(`    Error: ${error6}`, 'red');
        }
      }
    } catch (error) {
      log(`  ✗ ${metric}: ERROR - ${error.message}`, 'red');
    }
  }
}

function showInstructions() {
  log('\n📋 How to get access token:', 'blue');
  log('1. Go to http://localhost:3000/dashboard/youtube', 'yellow');
  log('2. Complete OAuth flow', 'yellow');
  log('3. Open browser dev tools (F12)', 'yellow');
  log('4. Go to Application > Local Storage > http://localhost:3000', 'yellow');
  log('5. Find youtube_access_token value', 'yellow');
  log('6. Run: YOUTUBE_ACCESS_TOKEN="ya29...." node scripts/test-youtube-analytics.js', 'yellow');
}

async function main() {
  log('🧪 YouTube Analytics API Test Suite', 'blue');
  log('=====================================', 'blue');
  
  if (ACCESS_TOKEN === 'YOUR_ACCESS_TOKEN_HERE') {
    showInstructions();
    return;
  }
  
  await testYouTubeAnalyticsAPI();
  
  log('\n🏁 Test suite complete!', 'blue');
  log('\n💡 If queries are failing, the issue is likely:', 'yellow');
  log('  - Invalid metric names for your account type', 'yellow');
  log('  - Dimension combinations not supported', 'yellow');
  log('  - Date range too recent (try older dates)', 'yellow');
}

// Run the tests
main().catch(error => {
  log(`\n💥 Test suite crashed: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});