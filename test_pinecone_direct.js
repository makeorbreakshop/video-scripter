#!/usr/bin/env node
/**
 * Direct Pinecone test to isolate the vector upsert issue
 * This script tests the exact same operations as our backend code
 */

require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');

async function testPineconeDirectly() {
  console.log('🧪 Testing Pinecone directly...\n');
  
  // Initialize Pinecone
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });
  
  const indexName = process.env.PINECONE_INDEX_NAME;
  console.log(`📍 Using index: ${indexName}`);
  
  try {
    // Step 1: Test connection
    console.log('\n📡 Step 1: Testing connection...');
    const index = pinecone.index(indexName);
    const stats = await index.describeIndexStats();
    console.log('✅ Connection successful:', {
      totalVectors: stats.totalVectorCount,
      dimension: stats.dimension,
      indexFullness: stats.indexFullness
    });
    
    // Step 2: Test minimal vector
    console.log('\n🧪 Step 2: Testing minimal vector...');
    const minimalVector = {
      id: 'test-minimal-123',
      values: new Array(512).fill(0.1),
      metadata: { test: 'minimal' }
    };
    
    console.log('🔍 Minimal vector structure:');
    console.log('  - id:', minimalVector.id);
    console.log('  - values length:', minimalVector.values.length);
    console.log('  - metadata:', minimalVector.metadata);
    
    try {
      await index.upsert([minimalVector]);
      console.log('✅ Minimal vector upsert successful');
    } catch (error) {
      console.log('❌ Minimal vector upsert failed:', error.message);
    }
    
    // Step 3: Test video-like vector (matching our format exactly)
    console.log('\n🎥 Step 3: Testing video-like vector...');
    const videoData = {
      id: 'test-video-456',
      title: 'Test Video Title',
      channel_id: 'test-channel-123',
      view_count: 1000,
      published_at: '2023-01-01T00:00:00Z',
      performance_ratio: 1.5
    };
    
    // Create vector exactly as our title-embeddings.ts does
    const videoVector = {
      id: String(videoData.id),
      values: new Array(512).fill(0.2), // Mock embedding
      metadata: {
        title: String(videoData.title || ''),
        channel_id: String(videoData.channel_id || ''),
        view_count: Number(videoData.view_count || 0),
        published_at: String(videoData.published_at || ''),
        performance_ratio: Number(videoData.performance_ratio || 0),
        embedding_version: 'v1',
      },
    };
    
    console.log('🔍 Video vector structure:');
    console.log('  - id:', videoVector.id, typeof videoVector.id);
    console.log('  - values length:', videoVector.values.length);
    console.log('  - metadata keys:', Object.keys(videoVector.metadata));
    console.log('  - has all required fields:', !!(videoVector.id && videoVector.values && videoVector.metadata));
    
    // Log the actual object structure
    console.log('\n🔍 Full vector object:');
    console.log(JSON.stringify(videoVector, null, 2));
    
    try {
      console.log('\n⏳ Attempting video vector upsert...');
      const result = await index.upsert([videoVector]);
      console.log('✅ Video vector upsert successful:', result);
      
      // Verify it was stored
      const fetchResult = await index.fetch([videoVector.id]);
      if (fetchResult.records && fetchResult.records[videoVector.id]) {
        console.log('✅ Vector successfully retrieved after upsert');
      } else {
        console.log('⚠️ Vector upserted but not immediately retrievable');
      }
      
    } catch (error) {
      console.log('❌ Video vector upsert failed:', error.message);
      console.log('❌ Error details:', error);
      
      // Log the exact vector that failed
      console.log('\n🔍 Failed vector was:');
      console.log(JSON.stringify(videoVector, null, 2));
    }
    
    // Step 4: Test array vs single vector
    console.log('\n📦 Step 4: Testing array vs single vector...');
    const singleVector = {
      id: 'test-single-789',
      values: new Array(512).fill(0.3),
      metadata: { test: 'single' }
    };
    
    try {
      // Test without array wrapper
      console.log('Testing vector without array wrapper...');
      await index.upsert(singleVector); // This should fail
      console.log('✅ Non-array upsert worked (unexpected)');
    } catch (error) {
      console.log('❌ Non-array upsert failed as expected:', error.message);
    }
    
    try {
      // Test with array wrapper
      console.log('Testing vector with array wrapper...');
      await index.upsert([singleVector]);
      console.log('✅ Array upsert worked');
    } catch (error) {
      console.log('❌ Array upsert failed:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testPineconeDirectly().catch(console.error);