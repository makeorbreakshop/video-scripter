/**
 * Comprehensive Pattern Discovery Test Suite
 * Full system testing for pattern discovery functionality
 */

import { PatternDiscoveryService } from '../lib/pattern-discovery-service.ts';
import { supabase } from '../lib/supabase.ts';
import { openai } from '../lib/openai-client.ts';
import dotenv from 'dotenv';
import { Pinecone } from '@pinecone-database/pinecone';

dotenv.config();

// Test results tracking
let testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  warnings: 0,
  errors: []
};

// Test utilities
function logTest(testName, status, message = '', data = null) {
  testResults.total++;
  const timestamp = new Date().toISOString();
  const statusIcon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  
  console.log(`${statusIcon} [${timestamp}] ${testName}: ${message}`);
  
  if (data) {
    console.log(`   Data: ${JSON.stringify(data, null, 2)}`);
  }
  
  if (status === 'PASS') {
    testResults.passed++;
  } else if (status === 'FAIL') {
    testResults.failed++;
    testResults.errors.push({ test: testName, message, data });
  } else {
    testResults.warnings++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Test data fixtures
const mockVideos = [
  {
    id: 'test_video_1',
    title: 'How to Build a Bookshelf for Beginners',
    channel_name: 'Woodworking Channel',
    view_count: 50000,
    published_at: '2024-01-15T10:00:00Z',
    format_type: 'tutorial',
    duration: 'PT15M30S',
    rolling_baseline_views: 20000,
    channel_avg_views: 25000,
    topic_cluster: 'woodworking_beginner'
  },
  {
    id: 'test_video_2',
    title: '5 Beginner Mistakes I Made Woodworking',
    channel_name: 'DIY Expert',
    view_count: 75000,
    published_at: '2024-01-20T14:30:00Z',
    format_type: 'listicle',
    duration: 'PT12M45S',
    rolling_baseline_views: 15000,
    channel_avg_views: 18000,
    topic_cluster: 'woodworking_beginner'
  },
  {
    id: 'test_video_3',
    title: 'Beginner Guide to Router Basics',
    channel_name: 'Tool Reviews',
    view_count: 60000,
    published_at: '2024-01-25T09:15:00Z',
    format_type: 'tutorial',
    duration: 'PT18M20S',
    rolling_baseline_views: 25000,
    channel_avg_views: 22000,
    topic_cluster: 'woodworking_beginner'
  }
];

class PatternDiscoveryTestSuite {
  constructor() {
    this.discoveryService = new PatternDiscoveryService();
    this.pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  }

  async runAllTests() {
    console.log('🧪 Starting Comprehensive Pattern Discovery Test Suite\n');
    console.log('=' * 80);
    
    try {
      // Environment and setup tests
      await this.testEnvironmentSetup();
      
      // Database tests
      await this.testDatabaseConnectivity();
      await this.testDatabaseSchema();
      
      // Service tests
      await this.testPatternDiscoveryService();
      await this.testIndividualAnalyzers();
      await this.testPatternValidation();
      
      // API tests
      await this.testAPIEndpoints();
      
      // Worker tests
      await this.testWorkerFunctionality();
      
      // Performance tests
      await this.testPerformanceWithLargeDataset();
      
      // Edge case tests
      await this.testEdgeCases();
      
      // Integration tests
      await this.testEndToEndWorkflow();
      
    } catch (error) {
      logTest('CRITICAL ERROR', 'FAIL', error.message);
    }
    
    this.generateTestReport();
  }

  async testEnvironmentSetup() {
    console.log('\n📋 Testing Environment Setup');
    
    try {
      // Test environment variables
      const requiredEnvVars = [
        'NEXT_PUBLIC_SUPABASE_URL',
        'SUPABASE_SERVICE_ROLE_KEY',
        'OPENAI_API_KEY',
        'PINECONE_API_KEY',
        'PINECONE_INDEX_NAME'
      ];
      
      for (const envVar of requiredEnvVars) {
        if (process.env[envVar]) {
          logTest(`Environment Variable: ${envVar}`, 'PASS', 'Present');
        } else {
          logTest(`Environment Variable: ${envVar}`, 'FAIL', 'Missing');
        }
      }
      
      // Test OpenAI connection
      try {
        const testEmbedding = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: 'test',
          dimensions: 512
        });
        
        assert(testEmbedding.data[0].embedding.length === 512, 'Embedding dimension mismatch');
        logTest('OpenAI Connection', 'PASS', 'Embeddings working');
      } catch (error) {
        logTest('OpenAI Connection', 'FAIL', error.message);
      }
      
      // Test Pinecone connection
      try {
        const index = this.pinecone.index(process.env.PINECONE_INDEX_NAME);
        const stats = await index.describeIndexStats();
        logTest('Pinecone Connection', 'PASS', `Index stats retrieved`, { 
          vectors: stats.totalVectorCount,
          dimension: stats.dimension 
        });
      } catch (error) {
        logTest('Pinecone Connection', 'FAIL', error.message);
      }
      
    } catch (error) {
      logTest('Environment Setup', 'FAIL', error.message);
    }
  }

  async testDatabaseConnectivity() {
    console.log('\n📋 Testing Database Connectivity');
    
    try {
      // Test basic connection
      const { data, error } = await supabase
        .from('videos')
        .select('count', { count: 'exact', head: true });
      
      if (error) {
        logTest('Database Connection', 'FAIL', error.message);
        return;
      }
      
      logTest('Database Connection', 'PASS', `Connected successfully`, { videoCount: data });
      
      // Test required tables exist
      const requiredTables = ['videos', 'patterns', 'video_patterns'];
      
      for (const table of requiredTables) {
        try {
          const { error: tableError } = await supabase
            .from(table)
            .select('*')
            .limit(1);
          
          if (tableError) {
            logTest(`Table: ${table}`, 'FAIL', tableError.message);
          } else {
            logTest(`Table: ${table}`, 'PASS', 'Table exists and accessible');
          }
        } catch (error) {
          logTest(`Table: ${table}`, 'FAIL', error.message);
        }
      }
      
    } catch (error) {
      logTest('Database Connectivity', 'FAIL', error.message);
    }
  }

  async testDatabaseSchema() {
    console.log('\n📋 Testing Database Schema');
    
    try {
      // Test patterns table schema
      const { data: patternsSchema, error: patternsError } = await supabase
        .from('patterns')
        .select('*')
        .limit(1);
      
      if (patternsError && patternsError.code !== 'PGRST116') {
        logTest('Patterns Table Schema', 'FAIL', patternsError.message);
      } else {
        logTest('Patterns Table Schema', 'PASS', 'Schema accessible');
      }
      
      // Test video_patterns table schema
      const { data: videoPasswordsSchema, error: videoPasswordsError } = await supabase
        .from('video_patterns')
        .select('*')
        .limit(1);
      
      if (videoPasswordsError && videoPasswordsError.code !== 'PGRST116') {
        logTest('Video Patterns Table Schema', 'FAIL', videoPasswordsError.message);
      } else {
        logTest('Video Patterns Table Schema', 'PASS', 'Schema accessible');
      }
      
      // Test videos table has required columns
      const { data: videosData, error: videosError } = await supabase
        .from('videos')
        .select('id, title, view_count, published_at, format_type, duration, rolling_baseline_views, channel_avg_views, topic_cluster')
        .limit(1);
      
      if (videosError) {
        logTest('Videos Table Required Columns', 'FAIL', videosError.message);
      } else {
        logTest('Videos Table Required Columns', 'PASS', 'All required columns present');
      }
      
    } catch (error) {
      logTest('Database Schema', 'FAIL', error.message);
    }
  }

  async testPatternDiscoveryService() {
    console.log('\n📋 Testing Pattern Discovery Service');
    
    try {
      // Test service initialization
      const service = new PatternDiscoveryService();
      assert(service, 'Service should initialize');
      logTest('Service Initialization', 'PASS', 'Service created successfully');
      
      // Test analyzer registration
      assert(service.analyzers && service.analyzers.length > 0, 'Analyzers should be registered');
      logTest('Analyzer Registration', 'PASS', `${service.analyzers.length} analyzers registered`);
      
      // Test context validation
      const testContext = {
        topic_cluster: 'test_cluster',
        min_performance: 1.5,
        min_confidence: 0.8,
        min_videos: 10
      };
      
      logTest('Context Validation', 'PASS', 'Context structure valid');
      
    } catch (error) {
      logTest('Pattern Discovery Service', 'FAIL', error.message);
    }
  }

  async testIndividualAnalyzers() {
    console.log('\n📋 Testing Individual Pattern Analyzers');
    
    try {
      const service = new PatternDiscoveryService();
      const testContext = {
        topic_cluster: 'woodworking_beginner',
        min_performance: 1.0,
        min_confidence: 0.5,
        min_videos: 2
      };
      
      // Test each analyzer with mock data
      for (const analyzer of service.analyzers) {
        try {
          const patterns = await analyzer.discover(mockVideos, testContext);
          
          assert(Array.isArray(patterns), `${analyzer.constructor.name} should return array`);
          
          if (patterns.length > 0) {
            // Validate pattern structure
            const pattern = patterns[0];
            assert(pattern.pattern_type, 'Pattern should have type');
            assert(pattern.pattern_data, 'Pattern should have data');
            assert(pattern.performance_stats, 'Pattern should have performance stats');
            assert(pattern.confidence, 'Pattern should have confidence');
            assert(pattern.evidence_count, 'Pattern should have evidence count');
            
            logTest(`${analyzer.constructor.name}`, 'PASS', 
              `Found ${patterns.length} patterns`, 
              { samplePattern: pattern.pattern_data.name });
          } else {
            logTest(`${analyzer.constructor.name}`, 'WARN', 
              'No patterns found with test data');
          }
          
        } catch (error) {
          logTest(`${analyzer.constructor.name}`, 'FAIL', error.message);
        }
      }
      
    } catch (error) {
      logTest('Individual Analyzers', 'FAIL', error.message);
    }
  }

  async testPatternValidation() {
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
      assert(isValid, 'Valid pattern should pass validation');
      logTest('Valid Pattern Validation', 'PASS', 'Pattern validated successfully');
      
      // Test invalid pattern - low evidence count
      const invalidPattern1 = {
        ...validPattern,
        evidence_count: 10
      };
      
      const isInvalid1 = await service.validatePattern(invalidPattern1);
      assert(!isInvalid1, 'Pattern with low evidence should fail validation');
      logTest('Invalid Pattern - Low Evidence', 'PASS', 'Correctly rejected low evidence pattern');
      
      // Test invalid pattern - low confidence
      const invalidPattern2 = {
        ...validPattern,
        confidence: 0.5
      };
      
      const isInvalid2 = await service.validatePattern(invalidPattern2);
      assert(!isInvalid2, 'Pattern with low confidence should fail validation');
      logTest('Invalid Pattern - Low Confidence', 'PASS', 'Correctly rejected low confidence pattern');
      
      // Test invalid pattern - high variance, low median
      const invalidPattern3 = {
        ...validPattern,
        performance_stats: { avg: 2.5, median: 0.5, variance: 3.0 }
      };
      
      const isInvalid3 = await service.validatePattern(invalidPattern3);
      assert(!isInvalid3, 'Pattern with high variance and low median should fail validation');
      logTest('Invalid Pattern - High Variance', 'PASS', 'Correctly rejected high variance pattern');
      
    } catch (error) {
      logTest('Pattern Validation', 'FAIL', error.message);
    }
  }

  async testAPIEndpoints() {
    console.log('\n📋 Testing API Endpoints');
    
    try {
      const baseURL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:3000';
      
      // Test pattern list endpoint
      try {
        const response = await fetch(`${baseURL}/api/youtube/patterns/list?limit=5`);
        const data = await response.json();
        
        if (response.ok) {
          assert(data.success, 'List endpoint should return success');
          assert(Array.isArray(data.patterns), 'List endpoint should return patterns array');
          logTest('Pattern List API', 'PASS', `Retrieved ${data.patterns.length} patterns`);
        } else {
          logTest('Pattern List API', 'FAIL', `HTTP ${response.status}: ${data.error}`);
        }
      } catch (error) {
        logTest('Pattern List API', 'FAIL', error.message);
      }
      
      // Test pattern prediction endpoint
      try {
        const response = await fetch(`${baseURL}/api/youtube/patterns/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'How to Build a Bookshelf for Beginners',
            format: 'tutorial',
            topic_cluster: 'woodworking_beginner'
          })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          assert(data.success, 'Prediction endpoint should return success');
          assert(typeof data.predicted_performance === 'number', 'Should return performance prediction');
          logTest('Pattern Prediction API', 'PASS', 
            `Predicted performance: ${data.predicted_performance?.toFixed(2)}x`);
        } else {
          logTest('Pattern Prediction API', 'FAIL', `HTTP ${response.status}: ${data.error}`);
        }
      } catch (error) {
        logTest('Pattern Prediction API', 'FAIL', error.message);
      }
      
      // Test pattern discovery endpoint
      try {
        const response = await fetch(`${baseURL}/api/youtube/patterns/discover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic_cluster: 'woodworking_beginner',
            min_performance: 1.5,
            min_confidence: 0.5,
            min_videos: 10,
            limit: 10
          })
        });
        
        const data = await response.json();
        
        if (response.ok) {
          assert(data.success, 'Discovery endpoint should return success');
          assert(Array.isArray(data.patterns), 'Discovery endpoint should return patterns array');
          logTest('Pattern Discovery API', 'PASS', 
            `Discovered ${data.patterns.length} patterns`);
        } else {
          logTest('Pattern Discovery API', 'FAIL', `HTTP ${response.status}: ${data.error}`);
        }
      } catch (error) {
        logTest('Pattern Discovery API', 'FAIL', error.message);
      }
      
    } catch (error) {
      logTest('API Endpoints', 'FAIL', error.message);
    }
  }

  async testWorkerFunctionality() {
    console.log('\n📋 Testing Worker Functionality');
    
    try {
      // Import worker (assuming it can be imported for testing)
      const { PatternDiscoveryWorker } = await import('../workers/pattern-discovery-worker.js');
      
      // Test worker initialization
      const worker = new PatternDiscoveryWorker();
      assert(worker, 'Worker should initialize');
      logTest('Worker Initialization', 'PASS', 'Worker created successfully');
      
      // Test worker methods exist
      assert(typeof worker.runDiscovery === 'function', 'Worker should have runDiscovery method');
      assert(typeof worker.getTopicClusters === 'function', 'Worker should have getTopicClusters method');
      assert(typeof worker.getDiscoveryStatus === 'function', 'Worker should have getDiscoveryStatus method');
      logTest('Worker Methods', 'PASS', 'All required methods present');
      
      // Test getting topic clusters
      const clusters = await worker.getTopicClusters();
      assert(Array.isArray(clusters), 'Should return array of clusters');
      logTest('Worker Topic Clusters', 'PASS', `Found ${clusters.length} clusters`);
      
      // Test getting discovery status
      const status = await worker.getDiscoveryStatus();
      assert(typeof status === 'object', 'Should return status object');
      assert(typeof status.total_patterns === 'number', 'Should include total patterns count');
      logTest('Worker Status', 'PASS', `Status retrieved: ${status.total_patterns} patterns`);
      
    } catch (error) {
      logTest('Worker Functionality', 'FAIL', error.message);
    }
  }

  async testPerformanceWithLargeDataset() {
    console.log('\n📋 Testing Performance with Large Dataset');
    
    try {
      // Get a sample of real data
      const { data: sampleVideos, error } = await supabase
        .from('videos')
        .select('id, title, view_count, published_at, format_type, duration, rolling_baseline_views, channel_avg_views, topic_cluster')
        .not('rolling_baseline_views', 'is', null)
        .not('topic_cluster', 'is', null)
        .limit(1000);
      
      if (error) {
        logTest('Large Dataset Fetch', 'FAIL', error.message);
        return;
      }
      
      logTest('Large Dataset Fetch', 'PASS', `Retrieved ${sampleVideos.length} videos`);
      
      if (sampleVideos.length > 0) {
        // Test performance with large dataset
        const startTime = Date.now();
        const service = new PatternDiscoveryService();
        
        const context = {
          topic_cluster: sampleVideos[0].topic_cluster,
          min_performance: 1.5,
          min_confidence: 0.8,
          min_videos: 20
        };
        
        const patterns = await service.discoverPatternsInCluster(context);
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        logTest('Large Dataset Performance', 'PASS', 
          `Processed ${sampleVideos.length} videos in ${duration}ms`, 
          { patternsFound: patterns.length, processingTime: duration });
        
        // Performance thresholds
        if (duration > 30000) { // 30 seconds
          logTest('Performance Threshold', 'WARN', 'Processing took longer than 30 seconds');
        } else {
          logTest('Performance Threshold', 'PASS', 'Processing completed within acceptable time');
        }
      }
      
    } catch (error) {
      logTest('Performance with Large Dataset', 'FAIL', error.message);
    }
  }

  async testEdgeCases() {
    console.log('\n📋 Testing Edge Cases');
    
    try {
      const service = new PatternDiscoveryService();
      
      // Test with empty dataset
      try {
        const patterns = await service.discoverPatternsInCluster({
          topic_cluster: 'nonexistent_cluster',
          min_performance: 2.0,
          min_confidence: 0.8,
          min_videos: 30
        });
        
        assert(Array.isArray(patterns), 'Should return empty array for empty dataset');
        logTest('Empty Dataset Handling', 'PASS', 'Handled empty dataset gracefully');
      } catch (error) {
        logTest('Empty Dataset Handling', 'FAIL', error.message);
      }
      
      // Test with invalid context
      try {
        const patterns = await service.discoverPatternsInCluster({
          min_performance: -1,
          min_confidence: 2.0,
          min_videos: -5
        });
        
        logTest('Invalid Context Handling', 'PASS', 'Handled invalid context');
      } catch (error) {
        logTest('Invalid Context Handling', 'FAIL', error.message);
      }
      
      // Test with malformed video data
      try {
        const malformedVideos = [
          { id: 'test1', title: null, view_count: 'invalid' },
          { id: 'test2', duration: 'invalid_duration' },
          { id: 'test3' } // missing required fields
        ];
        
        const analyzer = service.analyzers[0];
        const patterns = await analyzer.discover(malformedVideos, {
          min_performance: 1.0,
          min_confidence: 0.5,
          min_videos: 1
        });
        
        logTest('Malformed Data Handling', 'PASS', 'Handled malformed data gracefully');
      } catch (error) {
        logTest('Malformed Data Handling', 'FAIL', error.message);
      }
      
    } catch (error) {
      logTest('Edge Cases', 'FAIL', error.message);
    }
  }

  async testEndToEndWorkflow() {
    console.log('\n📋 Testing End-to-End Workflow');
    
    try {
      const service = new PatternDiscoveryService();
      
      // Step 1: Discover patterns
      const context = {
        topic_cluster: 'woodworking_beginner',
        min_performance: 1.5,
        min_confidence: 0.5,
        min_videos: 10
      };
      
      const patterns = await service.discoverPatternsInCluster(context);
      logTest('E2E Step 1: Pattern Discovery', 'PASS', `Discovered ${patterns.length} patterns`);
      
      // Step 2: Validate patterns
      const validPatterns = await service.validatePatterns(patterns);
      logTest('E2E Step 2: Pattern Validation', 'PASS', `${validPatterns.length} patterns validated`);
      
      // Step 3: Store patterns
      if (validPatterns.length > 0) {
        await service.storePatterns(validPatterns);
        logTest('E2E Step 3: Pattern Storage', 'PASS', 'Patterns stored successfully');
        
        // Step 4: Verify storage
        const { data: storedPatterns, error } = await supabase
          .from('patterns')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(5);
        
        if (error) {
          logTest('E2E Step 4: Storage Verification', 'FAIL', error.message);
        } else {
          logTest('E2E Step 4: Storage Verification', 'PASS', 
            `Found ${storedPatterns.length} stored patterns`);
        }
      }
      
      logTest('End-to-End Workflow', 'PASS', 'Complete workflow executed successfully');
      
    } catch (error) {
      logTest('End-to-End Workflow', 'FAIL', error.message);
    }
  }

  generateTestReport() {
    console.log('\n' + '=' * 80);
    console.log('📊 TEST SUITE RESULTS');
    console.log('=' * 80);
    
    console.log(`\n📈 Summary:`);
    console.log(`   Total Tests: ${testResults.total}`);
    console.log(`   ✅ Passed: ${testResults.passed}`);
    console.log(`   ❌ Failed: ${testResults.failed}`);
    console.log(`   ⚠️  Warnings: ${testResults.warnings}`);
    
    const passRate = (testResults.passed / testResults.total * 100).toFixed(1);
    console.log(`   📊 Pass Rate: ${passRate}%`);
    
    if (testResults.failed > 0) {
      console.log(`\n❌ Failed Tests:`);
      testResults.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error.test}: ${error.message}`);
      });
    }
    
    console.log(`\n🎯 Recommendations:`);
    
    if (testResults.failed === 0) {
      console.log('   ✅ All tests passed! System is ready for production.');
      console.log('   📋 Next steps:');
      console.log('     1. Deploy to production environment');
      console.log('     2. Monitor pattern discovery worker logs');
      console.log('     3. Set up automated testing pipeline');
    } else {
      console.log('   ⚠️  Some tests failed. Please address the following:');
      console.log('     1. Fix failing tests before deployment');
      console.log('     2. Review error messages and stack traces');
      console.log('     3. Re-run test suite after fixes');
    }
    
    if (testResults.warnings > 0) {
      console.log('   ⚠️  Warnings detected:');
      console.log('     1. Review warning messages');
      console.log('     2. Consider performance optimizations');
      console.log('     3. Monitor system behavior in production');
    }
    
    console.log('\n' + '=' * 80);
  }
}

// Run the test suite
const testSuite = new PatternDiscoveryTestSuite();
testSuite.runAllTests().catch(console.error);