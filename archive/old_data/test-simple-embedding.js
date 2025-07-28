/**
 * Test the complete embedding pipeline step by step
 */

require('dotenv').config();

async function testEmbeddingPipeline() {
  console.log('🧪 Testing embedding pipeline step by step...');
  
  try {
    // Step 1: Test OpenAI embedding generation
    console.log('\n📝 Step 1: Testing OpenAI embedding generation...');
    const openaiResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: 'Test video title for embedding',
        model: 'text-embedding-3-small',
        dimensions: 512
      })
    });
    
    if (!openaiResponse.ok) {
      console.log('❌ OpenAI API failed:', await openaiResponse.text());
      return;
    }
    
    const openaiData = await openaiResponse.json();
    console.log('✅ OpenAI embedding generated:', {
      dimensions: openaiData.data[0].embedding.length,
      firstFewValues: openaiData.data[0].embedding.slice(0, 3)
    });
    
    // Step 2: Test Pinecone connection
    console.log('\n🔗 Step 2: Testing Pinecone connection...');
    const healthResponse = await fetch('http://localhost:3000/api/embeddings/manage?operation=health');
    const health = await healthResponse.json();
    console.log('✅ Pinecone health:', health);
    
    // Step 3: Try our embedding API
    console.log('\n⚡ Step 3: Testing our embedding API...');
    const embeddingResponse = await fetch('http://localhost:3000/api/embeddings/titles/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        video_ids: ['KZGy7Q_jLXE'],
        limit: 1
      })
    });
    
    const embeddingResult = await embeddingResponse.json();
    console.log('🎯 Our API result:', embeddingResult);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testEmbeddingPipeline();