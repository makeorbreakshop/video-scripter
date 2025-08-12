/**
 * Test Idea Heist with REAL data (not mock)
 * This will verify we're using actual OpenAI and database data
 */

import dotenv from 'dotenv';
dotenv.config();

// First, verify environment
console.log('🔍 Environment Check:');
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing');
console.log('- SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ Set' : '❌ Missing');
console.log('- SUPABASE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing');
console.log('- PINECONE_API_KEY:', process.env.PINECONE_API_KEY ? '✅ Set' : '❌ Missing');

// Now test the actual video
const videoId = 'eKxNGFjyRv0'; // Rick Beato video

async function testIdeaHeist() {
  try {
    console.log('\n📺 Testing with video:', videoId);
    
    // Call the API endpoint
    const response = await fetch('http://localhost:3000/api/idea-heist/agentic-v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId: videoId,
        mode: 'agentic',
        options: {
          maxDurationMs: 60000, // 1 minute timeout for testing
        }
      })
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${response.statusText}`);
    }

    // Read streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let hasRealData = false;
    let toolCalls = [];
    let modelCalls = [];
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            // Check for specific event types
            if (data.type === 'tool_call') {
              console.log(`🔧 Tool: ${data.tool} with params:`, data.params);
              toolCalls.push(data);
            } else if (data.type === 'model_call') {
              console.log(`🤖 Model: ${data.model}, Tokens: ${data.tokens}, Cost: $${data.cost}`);
              modelCalls.push(data);
            } else if (data.type === 'complete') {
              console.log('\n✅ Analysis Complete!');
              console.log('Pattern:', data.pattern?.pattern_name || data.pattern?.statement);
              
              // Check if this is mock data
              if (data.pattern?.evidence) {
                const evidence = data.pattern.evidence;
                const mockIds = evidence.filter(e => 
                  e.videoId?.includes('-001') || 
                  e.videoId?.includes('rb-') ||
                  e.videoId?.includes('mock')
                );
                
                if (mockIds.length > 0) {
                  console.error('\n❌ MOCK DATA DETECTED!');
                  console.error('Mock video IDs found:', mockIds.map(e => e.videoId));
                  hasRealData = false;
                } else {
                  console.log('\n✅ REAL DATA CONFIRMED!');
                  console.log('Real video IDs:', evidence.slice(0, 3).map(e => e.videoId));
                  hasRealData = true;
                }
              }
              
              // Show metrics
              console.log('\n📊 Metrics:');
              console.log('- Tool calls:', toolCalls.length);
              console.log('- Model calls:', modelCalls.length);
              console.log('- Total tokens:', data.budgetUsage?.tokens || 0);
              console.log('- Total cost: $', data.budgetUsage?.totalCost || 0);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    
    // Final verdict
    console.log('\n🏁 Final Results:');
    console.log('- Real data used:', hasRealData ? '✅ YES' : '❌ NO (MOCK DATA)');
    console.log('- Tool calls made:', toolCalls.length > 0 ? `✅ ${toolCalls.length}` : '❌ NONE');
    console.log('- Model calls made:', modelCalls.length > 0 ? `✅ ${modelCalls.length}` : '❌ NONE');
    
    if (!hasRealData) {
      console.error('\n⚠️ The system is using MOCK DATA instead of real API calls!');
      console.error('This needs to be fixed in the orchestrator.');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testIdeaHeist();