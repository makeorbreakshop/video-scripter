/**
 * Test embedding API endpoints
 */

require('dotenv').config();

async function testEmbeddingAPIs() {
  const baseUrl = 'http://localhost:3000';
  
  try {
    console.log('🧪 Testing embedding API endpoints...');
    
    // Test 1: Get embedding stats
    console.log('\n📊 Testing embedding stats...');
    const statsResponse = await fetch(`${baseUrl}/api/embeddings/titles/batch`);
    const stats = await statsResponse.json();
    console.log('Stats:', stats);
    
    // Test 2: Get management stats
    console.log('\n🔧 Testing management stats...');
    const mgmtResponse = await fetch(`${baseUrl}/api/embeddings/manage?operation=stats`);
    const mgmtStats = await mgmtResponse.json();
    console.log('Management stats:', mgmtStats);
    
    // Test 3: Health check
    console.log('\n🏥 Testing health check...');
    const healthResponse = await fetch(`${baseUrl}/api/embeddings/manage?operation=health`);
    const health = await healthResponse.json();
    console.log('Health:', health);
    
    // Test 4: Test semantic search (with a sample query)
    console.log('\n🔍 Testing semantic search...');
    const searchResponse = await fetch(`${baseUrl}/api/search/semantic?query=how to save money&limit=5`);
    const searchResults = await searchResponse.json();
    console.log('Search results:', searchResults);
    
    console.log('\n✅ All API tests completed!');
  } catch (error) {
    console.error('❌ API test failed:', error);
  }
}

// Only run if the dev server is running
console.log('⚠️  Make sure your Next.js dev server is running (npm run dev)');
console.log('Press Ctrl+C to cancel, or wait 3 seconds to run tests...');

setTimeout(testEmbeddingAPIs, 3000);