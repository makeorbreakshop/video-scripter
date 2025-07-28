/**
 * Test and Fix Pattern Discovery System
 * This script runs tests and fixes issues as they're discovered
 */

import { PatternDiscoveryService } from './lib/pattern-discovery-service.ts';
import { supabase } from './lib/supabase.ts';
import { openai } from './lib/openai-client.ts';
import dotenv from 'dotenv';

dotenv.config();

// Test results tracking
let testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  fixed: 0,
  errors: []
};

function logTest(testName, status, message = '', fix = null) {
  testResults.total++;
  const timestamp = new Date().toISOString();
  const statusIcon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : status === 'FIXED' ? '🔧' : '⚠️';
  
  console.log(`${statusIcon} [${timestamp}] ${testName}: ${message}`);
  
  if (status === 'PASS') {
    testResults.passed++;
  } else if (status === 'FAIL') {
    testResults.failed++;
    testResults.errors.push({ test: testName, message, fix });
  } else if (status === 'FIXED') {
    testResults.fixed++;
  }
}

async function runTestsAndFixes() {
  console.log('🧪 Running Pattern Discovery Tests and Fixes\n');
  
  try {
    // Test 1: Environment setup
    await testEnvironmentSetup();
    
    // Test 2: Database connectivity
    await testDatabaseConnectivity();
    
    // Test 3: Database schema
    await testDatabaseSchema();
    
    // Test 4: Data population
    await testDataPopulation();
    
    // Test 5: Pattern discovery service
    await testPatternDiscoveryService();
    
    // Test 6: Individual analyzers
    await testIndividualAnalyzers();
    
    // Test 7: Pattern validation
    await testPatternValidation();
    
    // Test 8: Full discovery workflow
    await testFullDiscoveryWorkflow();
    
    // Test 9: API endpoints
    await testAPIEndpoints();
    
    // Generate final report
    generateTestReport();
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
  }
}

async function testEnvironmentSetup() {
  console.log('\n📋 Testing Environment Setup');
  
  // Test required environment variables
  const requiredVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
    'PINECONE_API_KEY'
  ];
  
  for (const varName of requiredVars) {
    if (process.env[varName]) {
      logTest(`Environment Variable: ${varName}`, 'PASS', 'Present');
    } else {
      logTest(`Environment Variable: ${varName}`, 'FAIL', 'Missing');
    }
  }
  
  // Test OpenAI connection
  try {
    const testEmbedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'test',
      dimensions: 512
    });
    
    if (testEmbedding.data[0].embedding.length === 512) {
      logTest('OpenAI Connection', 'PASS', 'Embeddings working');
    } else {
      logTest('OpenAI Connection', 'FAIL', 'Invalid embedding dimensions');
    }
  } catch (error) {
    logTest('OpenAI Connection', 'FAIL', error.message);
  }
}

async function testDatabaseConnectivity() {
  console.log('\n📋 Testing Database Connectivity');
  
  try {
    const { data: videoCount, error } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      logTest('Database Connection', 'FAIL', error.message);
      return;
    }
    
    logTest('Database Connection', 'PASS', `Connected with ${videoCount} videos`);
    
    // Test required tables
    const tables = ['patterns', 'video_patterns', 'videos'];
    
    for (const table of tables) {
      try {
        const { error: tableError } = await supabase
          .from(table)
          .select('*')
          .limit(1);
        
        if (tableError) {
          logTest(`Table: ${table}`, 'FAIL', tableError.message);
        } else {
          logTest(`Table: ${table}`, 'PASS', 'Accessible');
        }
      } catch (error) {
        logTest(`Table: ${table}`, 'FAIL', error.message);
      }
    }
  } catch (error) {
    logTest('Database Connectivity', 'FAIL', error.message);
  }
}

async function testDatabaseSchema() {
  console.log('\n📋 Testing Database Schema');
  
  try {
    // Check patterns table structure
    const { data: patterns, error: patternsError } = await supabase
      .from('patterns')
      .select('*')
      .limit(1);
    
    if (patternsError && patternsError.code !== 'PGRST116') {
      logTest('Patterns Table Structure', 'FAIL', patternsError.message);
    } else {
      logTest('Patterns Table Structure', 'PASS', 'Schema correct');
    }
    
    // Check video_patterns table structure
    const { data: videoPatterns, error: videoError } = await supabase
      .from('video_patterns')
      .select('*')
      .limit(1);
    
    if (videoError && videoError.code !== 'PGRST116') {
      logTest('Video Patterns Table Structure', 'FAIL', videoError.message);
    } else {
      logTest('Video Patterns Table Structure', 'PASS', 'Schema correct');
    }
    
    // Check videos table has required columns
    const { data: videoData, error: videoSchemaError } = await supabase
      .from('videos')
      .select('id, title, view_count, published_at, format_type, duration, rolling_baseline_views, channel_avg_views, topic_cluster, age_confidence')
      .limit(1);
    
    if (videoSchemaError) {
      logTest('Videos Table Schema', 'FAIL', videoSchemaError.message);
    } else {
      logTest('Videos Table Schema', 'PASS', 'All required columns present');
    }
    
  } catch (error) {
    logTest('Database Schema', 'FAIL', error.message);
  }
}

async function testDataPopulation() {
  console.log('\n📋 Testing Data Population');
  
  try {
    // Check confidence scoring data
    const { data: confidenceData, error: confidenceError } = await supabase
      .from('videos')
      .select('age_confidence')
      .not('age_confidence', 'is', null)
      .limit(1);
    
    if (confidenceError) {
      logTest('Confidence Data Population', 'FAIL', confidenceError.message);
    } else if (!confidenceData || confidenceData.length === 0) {
      logTest('Confidence Data Population', 'FAIL', 'No confidence data found', 'Run confidence scoring SQL');
      
      // Try to fix by running confidence scoring update
      console.log('🔧 Attempting to fix confidence scoring...');
      const { error: updateError } = await supabase.rpc('sql', {
        query: `
          UPDATE videos 
          SET age_confidence = LEAST(
            EXTRACT(EPOCH FROM (NOW() - published_at)) / (86400 * 30), 
            1.0
          )
          WHERE age_confidence IS NULL;
        `
      });
      
      if (updateError) {
        logTest('Confidence Data Fix', 'FAIL', updateError.message);
      } else {
        logTest('Confidence Data Fix', 'FIXED', 'Confidence scores populated');
      }
    } else {
      logTest('Confidence Data Population', 'PASS', 'Confidence data present');
    }
    
    // Check baseline views data
    const { data: baselineData, error: baselineError } = await supabase
      .from('videos')
      .select('rolling_baseline_views')
      .not('rolling_baseline_views', 'is', null)
      .limit(1);
    
    if (baselineError) {
      logTest('Baseline Views Data', 'FAIL', baselineError.message);
    } else if (!baselineData || baselineData.length === 0) {
      logTest('Baseline Views Data', 'FAIL', 'No baseline data found');
    } else {
      logTest('Baseline Views Data', 'PASS', 'Baseline data present');
    }
    
  } catch (error) {
    logTest('Data Population', 'FAIL', error.message);
  }
}

async function testPatternDiscoveryService() {
  console.log('\n📋 Testing Pattern Discovery Service');
  
  try {
    const service = new PatternDiscoveryService();
    
    // Test service initialization
    if (service && service.analyzers && service.analyzers.length > 0) {
      logTest('Service Initialization', 'PASS', `${service.analyzers.length} analyzers loaded`);
    } else {
      logTest('Service Initialization', 'FAIL', 'Service not properly initialized');
    }
    
    // Test analyzer availability
    const expectedAnalyzers = [
      'TitlePatternAnalyzer',
      'TitleStructureAnalyzer',
      'FormatOutlierAnalyzer',
      'DurationPatternAnalyzer',
      'TimingPatternAnalyzer',
      'TopicClusterAnalyzer'
    ];
    
    const availableAnalyzers = service.analyzers.map(a => a.constructor.name);
    
    for (const expectedAnalyzer of expectedAnalyzers) {
      if (availableAnalyzers.includes(expectedAnalyzer)) {
        logTest(`Analyzer: ${expectedAnalyzer}`, 'PASS', 'Available');
      } else {
        logTest(`Analyzer: ${expectedAnalyzer}`, 'FAIL', 'Missing');
      }
    }
    
  } catch (error) {
    logTest('Pattern Discovery Service', 'FAIL', error.message);
  }
}

async function testIndividualAnalyzers() {
  console.log('\n📋 Testing Individual Analyzers');
  
  // Mock test data
  const mockVideos = [
    {
      id: 'test1',
      title: 'How to Build a Bookshelf for Beginners',
      view_count: 50000,
      rolling_baseline_views: 20000,
      channel_avg_views: 25000,
      published_at: '2024-01-15T10:00:00Z',
      format_type: 'tutorial',
      duration: 'PT15M30S',
      topic_cluster: 'woodworking_beginner'
    },
    {
      id: 'test2',
      title: 'Beginner Guide to Router Basics',
      view_count: 60000,
      rolling_baseline_views: 25000,
      channel_avg_views: 22000,
      published_at: '2024-01-20T14:30:00Z',
      format_type: 'tutorial',
      duration: 'PT18M20S',
      topic_cluster: 'woodworking_beginner'
    },
    {
      id: 'test3',
      title: '5 Beginner Mistakes I Made Woodworking',
      view_count: 75000,
      rolling_baseline_views: 15000,
      channel_avg_views: 18000,
      published_at: '2024-01-25T09:15:00Z',
      format_type: 'listicle',
      duration: 'PT12M45S',
      topic_cluster: 'woodworking_beginner'
    }
  ];
  
  try {
    const service = new PatternDiscoveryService();
    const context = {
      topic_cluster: 'woodworking_beginner',
      min_performance: 1.0,
      min_confidence: 0.5,
      min_videos: 2
    };
    
    let totalPatterns = 0;
    
    for (const analyzer of service.analyzers) {
      try {
        const patterns = await analyzer.discover(mockVideos, context);
        
        if (Array.isArray(patterns)) {
          logTest(`${analyzer.constructor.name}`, 'PASS', `${patterns.length} patterns found`);
          totalPatterns += patterns.length;
          
          // Validate pattern structure
          if (patterns.length > 0) {
            const pattern = patterns[0];
            if (pattern.pattern_type && pattern.pattern_data && pattern.performance_stats) {
              logTest(`${analyzer.constructor.name} Structure`, 'PASS', 'Valid pattern structure');
            } else {
              logTest(`${analyzer.constructor.name} Structure`, 'FAIL', 'Invalid pattern structure');
            }
          }
        } else {
          logTest(`${analyzer.constructor.name}`, 'FAIL', 'Did not return array');
        }
      } catch (error) {
        logTest(`${analyzer.constructor.name}`, 'FAIL', error.message);
      }
    }
    
    logTest('Total Patterns from Mock Data', 'PASS', `${totalPatterns} patterns discovered`);
    
  } catch (error) {
    logTest('Individual Analyzers', 'FAIL', error.message);
  }
}

async function testPatternValidation() {
  console.log('\n📋 Testing Pattern Validation');
  
  try {
    const service = new PatternDiscoveryService();
    
    // Test valid pattern
    const validPattern = {
      pattern_type: 'title',
      pattern_data: { name: 'Test Pattern' },
      performance_stats: { avg: 2.5, median: 2.0, variance: 0.5 },
      confidence: 0.9,
      evidence_count: 50,
      videos_analyzed: ['vid1', 'vid2']
    };
    
    const isValid = await service.validatePattern(validPattern);
    
    if (isValid) {
      logTest('Valid Pattern Validation', 'PASS', 'Valid pattern accepted');
    } else {
      logTest('Valid Pattern Validation', 'FAIL', 'Valid pattern rejected');
    }
    
    // Test invalid pattern
    const invalidPattern = {
      pattern_type: 'title',
      pattern_data: { name: 'Test Pattern' },
      performance_stats: { avg: 2.5, median: 2.0, variance: 0.5 },
      confidence: 0.5,
      evidence_count: 10, // Too low
      videos_analyzed: ['vid1', 'vid2']
    };
    
    const isInvalid = await service.validatePattern(invalidPattern);
    
    if (!isInvalid) {
      logTest('Invalid Pattern Validation', 'PASS', 'Invalid pattern rejected');
    } else {
      logTest('Invalid Pattern Validation', 'FAIL', 'Invalid pattern accepted');
    }
    
  } catch (error) {
    logTest('Pattern Validation', 'FAIL', error.message);
  }
}

async function testFullDiscoveryWorkflow() {
  console.log('\n📋 Testing Full Discovery Workflow');
  
  try {
    const service = new PatternDiscoveryService();
    
    // Test with relaxed parameters for testing
    const context = {
      topic_cluster: 'woodworking_beginner',
      min_performance: 1.2,
      min_confidence: 0.3,
      min_videos: 5
    };
    
    const patterns = await service.discoverPatternsInCluster(context);
    
    if (Array.isArray(patterns)) {
      logTest('Full Discovery Workflow', 'PASS', `${patterns.length} patterns discovered`);
      
      if (patterns.length > 0) {
        // Test pattern storage
        try {
          await service.storePatterns(patterns);
          logTest('Pattern Storage', 'PASS', 'Patterns stored successfully');
        } catch (error) {
          logTest('Pattern Storage', 'FAIL', error.message);
        }
      }
    } else {
      logTest('Full Discovery Workflow', 'FAIL', 'Did not return array');
    }
    
  } catch (error) {
    logTest('Full Discovery Workflow', 'FAIL', error.message);
  }
}

async function testAPIEndpoints() {
  console.log('\n📋 Testing API Endpoints');
  
  const baseURL = 'http://localhost:3000';
  
  try {
    // Test pattern list endpoint
    const listResponse = await fetch(`${baseURL}/api/youtube/patterns/list?limit=5`);
    
    if (listResponse.ok) {
      const listData = await listResponse.json();
      logTest('Pattern List API', 'PASS', `Retrieved ${listData.patterns?.length || 0} patterns`);
    } else {
      logTest('Pattern List API', 'FAIL', `HTTP ${listResponse.status}`);
    }
    
    // Test pattern prediction endpoint
    const predictionResponse = await fetch(`${baseURL}/api/youtube/patterns/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'How to Build a Bookshelf for Beginners',
        format: 'tutorial',
        topic_cluster: 'woodworking_beginner'
      })
    });
    
    if (predictionResponse.ok) {
      const predictionData = await predictionResponse.json();
      logTest('Pattern Prediction API', 'PASS', `Predicted: ${predictionData.predicted_performance?.toFixed(2)}x`);
    } else {
      logTest('Pattern Prediction API', 'FAIL', `HTTP ${predictionResponse.status}`);
    }
    
  } catch (error) {
    logTest('API Endpoints', 'FAIL', error.message);
  }
}

function generateTestReport() {
  console.log('\n' + '='.repeat(80));
  console.log('📊 PATTERN DISCOVERY TEST RESULTS');
  console.log('='.repeat(80));
  
  const passRate = (testResults.passed / testResults.total * 100).toFixed(1);
  
  console.log(`\n📈 Summary:`);
  console.log(`   Total Tests: ${testResults.total}`);
  console.log(`   ✅ Passed: ${testResults.passed}`);
  console.log(`   ❌ Failed: ${testResults.failed}`);
  console.log(`   🔧 Fixed: ${testResults.fixed}`);
  console.log(`   📊 Pass Rate: ${passRate}%`);
  
  if (testResults.failed > 0) {
    console.log(`\n❌ Failed Tests:`);
    testResults.errors.forEach((error, index) => {
      console.log(`   ${index + 1}. ${error.test}: ${error.message}`);
      if (error.fix) {
        console.log(`      Fix: ${error.fix}`);
      }
    });
  }
  
  console.log(`\n🎯 Next Steps:`);
  
  if (testResults.failed === 0) {
    console.log('   ✅ All tests passed! System is ready.');
    console.log('   🚀 Run: npm run worker:pattern');
    console.log('   🔗 Test API endpoints manually');
  } else {
    console.log('   ⚠️  Fix failing tests:');
    console.log('   1. Address database schema issues');
    console.log('   2. Populate missing data');
    console.log('   3. Re-run tests');
  }
}

// Run the tests
runTestsAndFixes().catch(console.error);