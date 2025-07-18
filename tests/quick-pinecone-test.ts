/**
 * Quick test to diagnose Pinecone connection issues
 */

import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testPineconeConnection() {
  console.log('🧪 Testing Pinecone Connection...\n');
  
  if (!process.env.PINECONE_API_KEY) {
    console.error('❌ PINECONE_API_KEY not found in environment');
    return;
  }
  
  if (!process.env.PINECONE_INDEX_NAME) {
    console.error('❌ PINECONE_INDEX_NAME not found in environment');
    return;
  }
  
  try {
    // Initialize Pinecone
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    
    console.log('✅ Pinecone client initialized');
    
    // Get index
    const indexName = process.env.PINECONE_INDEX_NAME;
    const index = pinecone.index(indexName);
    console.log(`✅ Connected to index: ${indexName}`);
    
    // Get index stats
    console.log('\n📊 Getting index stats...');
    const stats = await index.describeIndexStats();
    console.log('Raw stats object:', JSON.stringify(stats, null, 2));
    
    // Check different property names
    const possibleCounts = {
      totalVectorCount: (stats as any).totalVectorCount,
      totalRecordCount: (stats as any).totalRecordCount,
      recordCount: (stats as any).recordCount,
      dimension: (stats as any).dimension,
      indexFullness: (stats as any).indexFullness,
    };
    
    console.log('\n🔍 Checking possible vector count properties:');
    Object.entries(possibleCounts).forEach(([key, value]) => {
      console.log(`  ${key}: ${value}`);
    });
    
    // Test a simple query
    console.log('\n🔍 Testing search query...');
    const testEmbedding = new Array(512).fill(0.1); // Dummy embedding
    
    const queryResponse = await index.query({
      vector: testEmbedding,
      topK: 5,
      includeMetadata: true,
      includeValues: true,
    });
    
    console.log(`✅ Query returned ${queryResponse.matches?.length || 0} results`);
    
    if (queryResponse.matches && queryResponse.matches.length > 0) {
      console.log('\n📝 First result:');
      const firstMatch = queryResponse.matches[0];
      console.log(`  ID: ${firstMatch.id}`);
      console.log(`  Score: ${firstMatch.score}`);
      console.log(`  Has values: ${firstMatch.values ? 'Yes' : 'No'}`);
      console.log(`  Values length: ${firstMatch.values?.length || 0}`);
      console.log(`  Metadata: ${JSON.stringify(firstMatch.metadata, null, 2)}`);
    }
    
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error during testing:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
  }
}

// Run the test
testPineconeConnection().then(() => {
  console.log('\n👋 Test completed');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 Test failed:', error);
  process.exit(1);
});