/**
 * API Integration Tests
 * Tests all pattern discovery API endpoints with real server interactions
 */

import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:3000';

class APIIntegrationTests {
  constructor() {
    this.results = { passed: 0, failed: 0, total: 0 };
  }

  logTest(testName, passed, message, data = null) {
    this.results.total++;
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${testName}: ${message}`);
    
    if (data) {
      console.log(`   Response: ${JSON.stringify(data, null, 2)}`);
    }
    
    if (passed) {
      this.results.passed++;
    } else {
      this.results.failed++;
    }
  }

  async runAllTests() {
    console.log('🧪 Running API Integration Tests\n');
    console.log(`Testing against: ${BASE_URL}`);
    
    try {
      await this.testPatternListEndpoint();
      await this.testPatternDiscoveryEndpoint();
      await this.testPatternPredictionEndpoint();
      await this.testErrorHandling();
      await this.testDataValidation();
      await this.testPerformanceMetrics();
      
      this.generateReport();
      
    } catch (error) {
      console.error('❌ API test suite failed:', error);
    }
  }

  async testPatternListEndpoint() {
    console.log('\n📋 Testing Pattern List Endpoint');
    
    try {
      // Test basic list request
      const response = await fetch(`${BASE_URL}/api/youtube/patterns/list`);
      const data = await response.json();
      
      this.logTest('List Endpoint Basic Request', 
        response.ok, 
        `HTTP ${response.status}`, 
        { success: data.success, patternCount: data.patterns?.length });
      
      if (response.ok) {
        this.logTest('List Response Structure', 
          data.success && Array.isArray(data.patterns), 
          'Has success flag and patterns array');
        
        this.logTest('List Pagination', 
          data.pagination && typeof data.pagination.total === 'number', 
          `Total: ${data.pagination?.total}`);
        
        // Test with filters
        const filterResponse = await fetch(`${BASE_URL}/api/youtube/patterns/list?type=title&limit=5`);
        const filterData = await filterResponse.json();
        
        this.logTest('List Endpoint Filters', 
          filterResponse.ok, 
          `Filtered results: ${filterData.patterns?.length}`);
        
        // Test with topic cluster filter
        const topicResponse = await fetch(`${BASE_URL}/api/youtube/patterns/list?topic_cluster=woodworking_beginner&limit=10`);
        const topicData = await topicResponse.json();
        
        this.logTest('List Topic Cluster Filter', 
          topicResponse.ok, 
          `Topic filtered results: ${topicData.patterns?.length}`);
        
        // Test pagination
        const paginationResponse = await fetch(`${BASE_URL}/api/youtube/patterns/list?limit=2&offset=0`);
        const paginationData = await paginationResponse.json();
        
        this.logTest('List Pagination Functionality', 
          paginationResponse.ok && paginationData.patterns?.length <= 2, 
          `Paginated results: ${paginationData.patterns?.length}`);
        
        // Test example videos in response
        if (data.patterns && data.patterns.length > 0) {
          const hasExamples = data.patterns[0].example_videos;
          this.logTest('List Example Videos', 
            !!hasExamples, 
            'Patterns include example videos');
        }
      }
      
    } catch (error) {
      this.logTest('Pattern List Endpoint', false, error.message);
    }
  }

  async testPatternDiscoveryEndpoint() {
    console.log('\n📋 Testing Pattern Discovery Endpoint');
    
    try {
      // Test pattern discovery request
      const requestBody = {
        topic_cluster: 'woodworking_beginner',
        min_performance: 1.5,
        min_confidence: 0.5,
        min_videos: 10,
        limit: 5
      };
      
      const response = await fetch(`${BASE_URL}/api/youtube/patterns/discover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });
      
      const data = await response.json();
      
      this.logTest('Discovery Endpoint Request', 
        response.ok, 
        `HTTP ${response.status}`, 
        { success: data.success, patternsDiscovered: data.patterns?.length });
      
      if (response.ok) {
        this.logTest('Discovery Response Structure', 
          data.success && Array.isArray(data.patterns), 
          'Has success flag and patterns array');
        
        this.logTest('Discovery Context Echo', 
          data.context && data.context.topic_cluster === requestBody.topic_cluster, 
          'Context parameters echoed correctly');
        
        this.logTest('Discovery Total Count', 
          typeof data.total_discovered === 'number', 
          `Total discovered: ${data.total_discovered}`);
        
        // Test discovered pattern structure
        if (data.patterns && data.patterns.length > 0) {
          const pattern = data.patterns[0];
          
          this.logTest('Discovery Pattern Structure', 
            pattern.pattern_type && pattern.pattern_data && pattern.performance_stats, 
            'Pattern has required fields');
          
          this.logTest('Discovery Pattern Confidence', 
            typeof pattern.confidence === 'number' && pattern.confidence >= 0 && pattern.confidence <= 1, 
            `Confidence: ${pattern.confidence}`);
          
          this.logTest('Discovery Evidence Count', 
            typeof pattern.evidence_count === 'number' && pattern.evidence_count > 0, 
            `Evidence: ${pattern.evidence_count} videos`);
        }
      }
      
      // Test without topic cluster
      const generalResponse = await fetch(`${BASE_URL}/api/youtube/patterns/discover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          min_performance: 2.0,
          min_confidence: 0.8,
          min_videos: 20,
          limit: 10
        })
      });
      
      const generalData = await generalResponse.json();
      
      this.logTest('Discovery General Patterns', 
        generalResponse.ok, 
        `General patterns: ${generalData.patterns?.length}`);
      
    } catch (error) {
      this.logTest('Pattern Discovery Endpoint', false, error.message);
    }
  }

  async testPatternPredictionEndpoint() {
    console.log('\n📋 Testing Pattern Prediction Endpoint');
    
    try {
      // Test prediction request
      const requestBody = {
        title: 'How to Build a Bookshelf for Beginners',
        format: 'tutorial',
        niche: 'woodworking',
        duration: '15-20min',
        topic_cluster: 'woodworking_beginner'
      };
      
      const response = await fetch(`${BASE_URL}/api/youtube/patterns/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });
      
      const data = await response.json();
      
      this.logTest('Prediction Endpoint Request', 
        response.ok, 
        `HTTP ${response.status}`, 
        { success: data.success, predictedPerformance: data.predicted_performance });
      
      if (response.ok) {
        this.logTest('Prediction Response Structure', 
          data.success && typeof data.predicted_performance === 'number', 
          'Has success flag and performance prediction');
        
        this.logTest('Prediction Performance Score', 
          data.predicted_performance > 0, 
          `Predicted: ${data.predicted_performance?.toFixed(2)}x`);
        
        this.logTest('Prediction Matching Patterns', 
          Array.isArray(data.matching_patterns), 
          `Matching patterns: ${data.matching_patterns?.length}`);
        
        this.logTest('Prediction Suggestions', 
          Array.isArray(data.suggestions), 
          `Suggestions: ${data.suggestions?.length}`);
        
        this.logTest('Prediction Analysis', 
          data.analysis && typeof data.analysis.confidence === 'number', 
          `Analysis confidence: ${data.analysis?.confidence?.toFixed(2)}`);
        
        // Test individual analysis scores
        if (data.analysis) {
          const analysis = data.analysis;
          
          this.logTest('Prediction Title Score', 
            typeof analysis.title_score === 'number', 
            `Title score: ${analysis.title_score?.toFixed(2)}`);
          
          this.logTest('Prediction Format Score', 
            typeof analysis.format_score === 'number', 
            `Format score: ${analysis.format_score?.toFixed(2)}`);
        }
      }
      
      // Test with minimal data
      const minimalResponse = await fetch(`${BASE_URL}/api/youtube/patterns/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Simple Test Title'
        })
      });
      
      const minimalData = await minimalResponse.json();
      
      this.logTest('Prediction Minimal Data', 
        minimalResponse.ok, 
        `Minimal prediction: ${minimalData.predicted_performance?.toFixed(2)}x`);
      
    } catch (error) {
      this.logTest('Pattern Prediction Endpoint', false, error.message);
    }
  }

  async testErrorHandling() {
    console.log('\n📋 Testing Error Handling');
    
    try {
      // Test missing required fields
      const missingFieldResponse = await fetch(`${BASE_URL}/api/youtube/patterns/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({})
      });
      
      this.logTest('Missing Required Fields', 
        missingFieldResponse.status === 400, 
        `HTTP ${missingFieldResponse.status} for missing title`);
      
      // Test invalid JSON
      const invalidJSONResponse = await fetch(`${BASE_URL}/api/youtube/patterns/discover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid json'
      });
      
      this.logTest('Invalid JSON Handling', 
        invalidJSONResponse.status >= 400, 
        `HTTP ${invalidJSONResponse.status} for invalid JSON`);
      
      // Test invalid HTTP method
      const invalidMethodResponse = await fetch(`${BASE_URL}/api/youtube/patterns/discover`, {
        method: 'GET'
      });
      
      this.logTest('Invalid HTTP Method', 
        invalidMethodResponse.status === 405, 
        `HTTP ${invalidMethodResponse.status} for GET on POST endpoint`);
      
      // Test invalid parameters
      const invalidParamsResponse = await fetch(`${BASE_URL}/api/youtube/patterns/discover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          min_performance: -1,
          min_confidence: 2.0,
          min_videos: -10
        })
      });
      
      const invalidParamsData = await invalidParamsResponse.json();
      
      this.logTest('Invalid Parameters Handling', 
        invalidParamsResponse.ok, 
        'Handled invalid parameters gracefully');
      
    } catch (error) {
      this.logTest('Error Handling', false, error.message);
    }
  }

  async testDataValidation() {
    console.log('\n📋 Testing Data Validation');
    
    try {
      // Test pattern list data validation
      const listResponse = await fetch(`${BASE_URL}/api/youtube/patterns/list?limit=3`);
      const listData = await listResponse.json();
      
      if (listResponse.ok && listData.patterns?.length > 0) {
        const pattern = listData.patterns[0];
        
        this.logTest('Pattern ID Validation', 
          typeof pattern.id === 'string', 
          'Pattern has valid ID');
        
        this.logTest('Pattern Type Validation', 
          ['title', 'format', 'timing', 'duration', 'compound', 'title_structure', 'topic_cluster'].includes(pattern.pattern_type), 
          `Pattern type: ${pattern.pattern_type}`);
        
        this.logTest('Pattern Data Validation', 
          pattern.pattern_data && typeof pattern.pattern_data === 'object', 
          'Pattern data is object');
        
        this.logTest('Performance Stats Validation', 
          pattern.performance_stats && typeof pattern.performance_stats === 'object', 
          'Performance stats is object');
        
        this.logTest('Created At Validation', 
          pattern.created_at && new Date(pattern.created_at).getTime() > 0, 
          'Created at is valid date');
        
        // Test example videos validation
        if (pattern.example_videos && pattern.example_videos.length > 0) {
          const exampleVideo = pattern.example_videos[0];
          
          this.logTest('Example Video Structure', 
            exampleVideo.id && exampleVideo.title && exampleVideo.channel_name, 
            'Example video has required fields');
          
          this.logTest('Example Video Match Score', 
            typeof exampleVideo.match_score === 'number' && exampleVideo.match_score >= 0 && exampleVideo.match_score <= 1, 
            `Match score: ${exampleVideo.match_score}`);
        }
      }
      
      // Test prediction data validation
      const predictionResponse = await fetch(`${BASE_URL}/api/youtube/patterns/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Test Title',
          format: 'tutorial'
        })
      });
      
      const predictionData = await predictionResponse.json();
      
      if (predictionResponse.ok) {
        this.logTest('Prediction Score Range', 
          predictionData.predicted_performance >= 0, 
          `Score: ${predictionData.predicted_performance?.toFixed(2)}`);
        
        this.logTest('Prediction Confidence Range', 
          predictionData.analysis?.confidence >= 0 && predictionData.analysis?.confidence <= 1, 
          `Confidence: ${predictionData.analysis?.confidence?.toFixed(2)}`);
        
        this.logTest('Suggestions Array', 
          Array.isArray(predictionData.suggestions), 
          `Suggestions count: ${predictionData.suggestions?.length}`);
      }
      
    } catch (error) {
      this.logTest('Data Validation', false, error.message);
    }
  }

  async testPerformanceMetrics() {
    console.log('\n📋 Testing Performance Metrics');
    
    try {
      // Test response time for list endpoint
      const listStartTime = Date.now();
      const listResponse = await fetch(`${BASE_URL}/api/youtube/patterns/list?limit=10`);
      const listEndTime = Date.now();
      const listDuration = listEndTime - listStartTime;
      
      this.logTest('List Endpoint Response Time', 
        listDuration < 5000, 
        `${listDuration}ms (threshold: 5000ms)`);
      
      // Test response time for prediction endpoint
      const predictionStartTime = Date.now();
      const predictionResponse = await fetch(`${BASE_URL}/api/youtube/patterns/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Performance Test Title',
          format: 'tutorial'
        })
      });
      const predictionEndTime = Date.now();
      const predictionDuration = predictionEndTime - predictionStartTime;
      
      this.logTest('Prediction Endpoint Response Time', 
        predictionDuration < 3000, 
        `${predictionDuration}ms (threshold: 3000ms)`);
      
      // Test concurrent requests
      const concurrentPromises = [];
      const concurrentCount = 5;
      
      for (let i = 0; i < concurrentCount; i++) {
        concurrentPromises.push(
          fetch(`${BASE_URL}/api/youtube/patterns/list?limit=5`)
        );
      }
      
      const concurrentStartTime = Date.now();
      const concurrentResponses = await Promise.all(concurrentPromises);
      const concurrentEndTime = Date.now();
      const concurrentDuration = concurrentEndTime - concurrentStartTime;
      
      const allSuccessful = concurrentResponses.every(r => r.ok);
      
      this.logTest('Concurrent Requests', 
        allSuccessful, 
        `${concurrentCount} concurrent requests in ${concurrentDuration}ms`);
      
      // Test response size
      const listData = await listResponse.json();
      const responseSize = JSON.stringify(listData).length;
      
      this.logTest('Response Size', 
        responseSize < 1000000, 
        `${responseSize} bytes (threshold: 1MB)`);
      
    } catch (error) {
      this.logTest('Performance Metrics', false, error.message);
    }
  }

  generateReport() {
    console.log('\n' + '=' * 60);
    console.log('📊 API INTEGRATION TEST RESULTS');
    console.log('=' * 60);
    
    const passRate = (this.results.passed / this.results.total * 100).toFixed(1);
    
    console.log(`\n📈 Summary:`);
    console.log(`   Total Tests: ${this.results.total}`);
    console.log(`   ✅ Passed: ${this.results.passed}`);
    console.log(`   ❌ Failed: ${this.results.failed}`);
    console.log(`   📊 Pass Rate: ${passRate}%`);
    
    if (this.results.failed === 0) {
      console.log('\n✅ All API integration tests passed!');
      console.log('   API endpoints are working correctly.');
      console.log('   Ready for frontend integration.');
    } else {
      console.log('\n❌ Some API tests failed.');
      console.log('   Please review the API implementations.');
      console.log('   Check server logs for detailed error information.');
    }
    
    console.log('\n🔗 Tested Endpoints:');
    console.log('   • GET /api/youtube/patterns/list');
    console.log('   • POST /api/youtube/patterns/discover');
    console.log('   • POST /api/youtube/patterns/predict');
  }
}

// Run the tests
const tests = new APIIntegrationTests();
tests.runAllTests().catch(console.error);