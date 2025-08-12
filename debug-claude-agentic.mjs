#!/usr/bin/env node
/**
 * Debug Claude Agentic Mode - Detailed Component Testing
 * Test each component individually to find the exact failure point
 */

import { config } from 'dotenv';
import { default as Anthropic } from '@anthropic-ai/sdk';
config();

console.log('🐛 Claude Agentic Debug Suite Starting...\n');

// Test 1: Basic Claude API with tools
async function testBasicToolUse() {
  console.log('🔧 Test 1: Basic Claude Tool Use...');
  
  try {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    // Simple tool test
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      tools: [{
        name: 'get_weather',
        description: 'Get weather for a location',
        input_schema: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City name' }
          },
          required: ['location']
        }
      }],
      messages: [{
        role: 'user',
        content: 'What is the weather in San Francisco? Use the get_weather tool.'
      }]
    });

    console.log('✅ Basic Tool Use Response:');
    console.log(`- Stop Reason: ${response.stop_reason}`);
    console.log(`- Content Blocks: ${response.content.length}`);
    
    for (const block of response.content) {
      console.log(`- Block Type: ${block.type}`);
      if (block.type === 'tool_use') {
        console.log(`  - Tool: ${block.name}`);
        console.log(`  - Input: ${JSON.stringify(block.input)}`);
      } else if (block.type === 'text') {
        console.log(`  - Text: ${block.text.substring(0, 100)}...`);
      }
    }
    
    if (response.stop_reason === 'tool_use') {
      console.log('✅ Claude correctly called a tool!');
      return true;
    } else {
      console.log('❌ Claude did not call the tool');
      return false;
    }
    
  } catch (error) {
    console.log('❌ Basic tool use failed:', error.message);
    return false;
  }
}

// Test 2: Test our API endpoints directly
async function testVideoBundle() {
  console.log('\n🔧 Test 2: Video Bundle API...');
  
  try {
    const response = await fetch('http://localhost:3000/api/tools/get-video-bundle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'debug-test',
        'x-analysis-mode': 'debug'
      },
      body: JSON.stringify({
        video_id: 'eKxNGFjyRv0'
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.log(`❌ Video bundle API failed (${response.status}):`, error.substring(0, 200));
      return false;
    }
    
    const result = await response.json();
    console.log('✅ Video Bundle API Response:');
    console.log(`- Title: ${result.title?.substring(0, 50)}...`);
    console.log(`- TPS: ${result.tps || result.temporal_performance_score}`);
    console.log(`- Channel: ${result.channel_name}`);
    console.log(`- Has Thumbnail: ${!!result.thumbnail_url}`);
    
    return true;
  } catch (error) {
    console.log('❌ Video bundle API failed:', error.message);
    return false;
  }
}

// Test 3: Test search tools
async function testSearchTools() {
  console.log('\n🔧 Test 3: Search Tools API...');
  
  try {
    const searchTests = [
      { endpoint: 'search-titles', query: 'music review' },
      { endpoint: 'search-summaries', query: 'opinion content' },
      { endpoint: 'search-thumbs', query: 'reaction content' }
    ];
    
    for (const test of searchTests) {
      console.log(`Testing ${test.endpoint}...`);
      const response = await fetch(`http://localhost:3000/api/tools/${test.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'debug-test'
        },
        body: JSON.stringify({
          query: test.query,
          limit: 5
        })
      });
      
      if (!response.ok) {
        console.log(`❌ ${test.endpoint} failed (${response.status})`);
        const error = await response.text();
        console.log(`Error: ${error.substring(0, 200)}`);
        return false;
      }
      
      const result = await response.json();
      console.log(`✅ ${test.endpoint}: ${result.results?.length || 0} results`);
    }
    
    return true;
  } catch (error) {
    console.log('❌ Search tools failed:', error.message);
    return false;
  }
}

// Test 4: Test the agentic endpoint with detailed logging
async function testAgenticEndpointDetailed() {
  console.log('\n🔧 Test 4: Detailed Agentic Endpoint Test...');
  
  try {
    console.log('Making request to agentic endpoint...');
    const response = await fetch('http://localhost:3000/api/idea-heist/claude-agentic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId: 'eKxNGFjyRv0',
        options: {
          maxFanouts: 1,
          maxValidations: 3,
          maxCandidates: 5,
          maxTokens: 8000,
          maxDurationMs: 60000,
          fallbackToClassic: false  // Disable fallback to see the real error
        }
      })
    });

    const result = await response.json();
    
    console.log('📊 Detailed Agentic Response:');
    console.log(`- Success: ${result.success}`);
    console.log(`- Mode: ${result.mode}`);
    console.log(`- Error: ${result.error || 'None'}`);
    console.log(`- Tool Calls: ${result.metrics?.toolCalls || 0}`);
    console.log(`- Tokens: ${result.metrics?.tokensUsed || 0}`);
    console.log(`- Execution Time: ${result.metrics?.executionTimeMs || 0}ms`);
    console.log(`- Model Switches: ${result.metrics?.modelSwitches || 0}`);
    
    if (result.error) {
      console.log('\n❌ AGENTIC ERROR DETAILS:');
      console.log(result.error);
      
      // If it's a long error, show more detail
      if (typeof result.error === 'string' && result.error.length > 200) {
        console.log('\n🔍 Full Error Trace:');
        console.log(result.error);
      }
    }
    
    if (result.pattern) {
      console.log('\n📋 Pattern Details:');
      console.log(`- Primary Pattern Type: ${result.pattern.primaryPattern?.type}`);
      console.log(`- Primary Pattern Confidence: ${result.pattern.primaryPattern?.confidence}`);
      console.log(`- Evidence Count: ${result.pattern.primaryPattern?.evidence?.length || 0}`);
    }
    
    return !result.error;
  } catch (error) {
    console.log('❌ Agentic endpoint test failed:', error.message);
    console.log('Stack trace:', error.stack);
    return false;
  }
}

// Test 5: Check server logs for the agentic call
async function checkServerLogs() {
  console.log('\n🔧 Test 5: Check for server-side logging...');
  
  // Make a test call and then check what was logged
  try {
    const response = await fetch('http://localhost:3000/api/idea-heist/claude-agentic', {
      method: 'GET'
    });
    
    const info = await response.json();
    console.log('✅ Server Info:');
    console.log(`- Status: ${info.status}`);
    console.log(`- Configured: ${info.configured}`);
    console.log(`- Models: ${info.models.join(', ')}`);
    console.log(`- Capabilities: ${info.capabilities.length}`);
    
    return true;
  } catch (error) {
    console.log('❌ Server info check failed:', error.message);
    return false;
  }
}

// Run all tests
async function runAllDebugTests() {
  const results = [];
  
  results.push(await testBasicToolUse());
  results.push(await testVideoBundle());
  results.push(await testSearchTools());
  results.push(await checkServerLogs());
  results.push(await testAgenticEndpointDetailed());
  
  console.log('\n📊 Debug Test Summary:');
  console.log(`- Basic Tool Use: ${results[0] ? '✅' : '❌'}`);
  console.log(`- Video Bundle API: ${results[1] ? '✅' : '❌'}`);
  console.log(`- Search Tools API: ${results[2] ? '✅' : '❌'}`);
  console.log(`- Server Info: ${results[3] ? '✅' : '❌'}`);
  console.log(`- Agentic Endpoint: ${results[4] ? '✅' : '❌'}`);
  
  const passed = results.filter(Boolean).length;
  console.log(`\n🎯 Overall: ${passed}/${results.length} tests passed`);
  
  if (passed === results.length) {
    console.log('\n🎉 All tests passed! The agentic flow should work without fallback.');
  } else {
    console.log('\n🔍 Some tests failed. The failing components need to be fixed.');
    console.log('\n💡 Next Steps:');
    if (!results[0]) console.log('  - Fix basic Claude tool use integration');
    if (!results[1]) console.log('  - Fix video bundle API endpoint');
    if (!results[2]) console.log('  - Fix search tools API endpoints');
    if (!results[3]) console.log('  - Fix server configuration');
    if (!results[4]) console.log('  - Debug the main agentic flow error');
  }
}

// Run the debug suite
await runAllDebugTests();
console.log('\n✨ Claude Agentic Debug Suite Complete!');