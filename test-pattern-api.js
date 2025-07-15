#!/usr/bin/env node

/**
 * Test Pattern API Endpoints
 * This script tests the pattern discovery system by making API calls
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const API_BASE = 'http://localhost:3000';

async function testPatternEndpoints() {
  console.log('🧪 Testing Pattern Discovery API Endpoints...\n');
  
  try {
    // Test 1: Pattern List Endpoint
    console.log('📋 Test 1: Pattern List Endpoint');
    console.log('URL: GET /api/youtube/patterns/list?limit=5');
    
    try {
      const listResponse = await fetch(`${API_BASE}/api/youtube/patterns/list?limit=5`);
      const listData = await listResponse.json();
      
      console.log('✅ Status:', listResponse.status);
      console.log('📊 Response:', JSON.stringify(listData, null, 2));
      
      if (listData.success) {
        console.log(`   Found ${listData.patterns?.length || 0} patterns`);
        console.log(`   Total available: ${listData.pagination?.total || 0}`);
      }
    } catch (error) {
      console.error('❌ Pattern List Error:', error.message);
    }
    
    // Test 2: Pattern Discovery Endpoint
    console.log('\n📋 Test 2: Pattern Discovery Endpoint');
    console.log('URL: POST /api/youtube/patterns/discover');
    
    const discoveryPayload = {
      topic_cluster: 37, // Using a real topic cluster ID from the database
      min_performance: 1.5,
      min_confidence: 0.7,
      min_videos: 5,
      limit: 10
    };
    
    console.log('📤 Payload:', JSON.stringify(discoveryPayload, null, 2));
    
    try {
      const discoveryResponse = await fetch(`${API_BASE}/api/youtube/patterns/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discoveryPayload)
      });
      
      const discoveryData = await discoveryResponse.json();
      
      console.log('✅ Status:', discoveryResponse.status);
      console.log('📊 Response:', JSON.stringify(discoveryData, null, 2));
      
      if (discoveryData.success) {
        console.log(`   Discovered ${discoveryData.patterns?.length || 0} patterns`);
        console.log(`   Total found: ${discoveryData.total_discovered || 0}`);
      }
    } catch (error) {
      console.error('❌ Pattern Discovery Error:', error.message);
    }
    
    // Test 3: Pattern Prediction Endpoint
    console.log('\n📋 Test 3: Pattern Prediction Endpoint');
    console.log('URL: POST /api/youtube/patterns/predict');
    
    const predictionPayload = {
      title: 'How to Build a Bookshelf for Beginners',
      format: 'tutorial',
      niche: 'woodworking',
      duration: 'PT15M30S',
      topic_cluster: 37
    };
    
    console.log('📤 Payload:', JSON.stringify(predictionPayload, null, 2));
    
    try {
      const predictionResponse = await fetch(`${API_BASE}/api/youtube/patterns/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(predictionPayload)
      });
      
      const predictionData = await predictionResponse.json();
      
      console.log('✅ Status:', predictionResponse.status);
      console.log('📊 Response:', JSON.stringify(predictionData, null, 2));
      
      if (predictionData.success) {
        console.log(`   Predicted Performance: ${predictionData.predicted_performance?.toFixed(2)}x`);
        console.log(`   Matching Patterns: ${predictionData.matching_patterns?.length || 0}`);
        console.log(`   Confidence: ${(predictionData.analysis?.confidence * 100)?.toFixed(1)}%`);
      }
    } catch (error) {
      console.error('❌ Pattern Prediction Error:', error.message);
    }
    
    // Test 4: Pattern By Topic Cluster Endpoint
    console.log('\n📋 Test 4: Pattern By Topic Cluster Endpoint');
    console.log('URL: GET /api/youtube/patterns/37 (topic cluster 37)');
    
    try {
      const topicResponse = await fetch(`${API_BASE}/api/youtube/patterns/37`);
      const topicData = await topicResponse.json();
      
      console.log('✅ Status:', topicResponse.status);
      console.log('📊 Response:', JSON.stringify(topicData, null, 2));
      
      if (topicData.success) {
        console.log(`   Cluster patterns: ${topicData.patterns?.length || 0}`);
      }
    } catch (error) {
      console.error('❌ Topic Cluster Error:', error.message);
    }
    
    console.log('\n🎉 Pattern API Test Complete!');
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
  }
}

// Check if server is running first
async function checkServer() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function main() {
  console.log('🔍 Checking if development server is running...');
  
  const serverRunning = await checkServer();
  
  if (!serverRunning) {
    console.log('❌ Development server not running on localhost:3000');
    console.log('💡 Please run: npm run dev');
    console.log('   Then run this test again');
    return;
  }
  
  console.log('✅ Development server detected');
  console.log('🚀 Running pattern API tests...\n');
  
  await testPatternEndpoints();
}

main().catch(console.error);