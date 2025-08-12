/**
 * Direct API test with simple timeout
 */

import dotenv from 'dotenv';
dotenv.config();

async function testAPI() {
  console.log('🚀 Testing agentic API directly...');
  
  try {
    const response = await fetch('http://localhost:3000/api/idea-heist/agentic-v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId: 'eKxNGFjyRv0',
        mode: 'agentic',
        options: {
          maxDurationMs: 10000, // 10 seconds
        }
      })
    });

    console.log('📡 Response status:', response.status);
    console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const text = await response.text();
      console.error('❌ API Error:', response.status, text);
      return;
    }

    // Read first few chunks
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let chunkCount = 0;
    
    console.log('📨 Reading response chunks...\n');
    
    const timeout = setTimeout(() => {
      console.log('⏰ Timeout reached, closing...');
      reader.cancel();
    }, 15000); // 15 second timeout
    
    while (chunkCount < 20) { // Max 20 chunks
      try {
        const { done, value } = await reader.read();
        if (done) {
          console.log('✅ Stream completed');
          break;
        }
        
        const text = decoder.decode(value, { stream: true });
        console.log(`Chunk ${++chunkCount}:`, text.substring(0, 200));
        
        if (text.includes('complete')) {
          console.log('✅ Found completion marker');
          break;
        }
        
      } catch (readError) {
        console.error('❌ Read error:', readError.message);
        break;
      }
    }
    
    clearTimeout(timeout);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testAPI();