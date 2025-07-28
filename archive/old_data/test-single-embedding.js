/**
 * Test single video embedding to debug the issue
 */

require('dotenv').config();

async function testSingleEmbedding() {
  try {
    console.log('🧪 Testing single video embedding...');
    
    // Test with a specific video ID
    const response = await fetch('http://localhost:3000/api/embeddings/titles/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        video_ids: ['KZGy7Q_jLXE'], // From our test query above
        limit: 1
      })
    });
    
    const result = await response.json();
    console.log('Result:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

console.log('⚠️  Make sure your Next.js dev server is running (npm run dev)');
console.log('Press Ctrl+C to cancel, or wait 2 seconds to run test...');

setTimeout(testSingleEmbedding, 2000);