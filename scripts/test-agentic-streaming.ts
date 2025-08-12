/**
 * Test script for agentic mode streaming debug functionality
 */

async function testAgenticStreaming() {
  const videoId = 'FVgupcKdIJM'; // Test video ID
  
  console.log('Testing agentic mode with streaming debug output...\n');
  
  try {
    const response = await fetch('http://localhost:3000/api/idea-heist/agentic-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        mode: 'agentic',
        options: {
          maxTokens: 10000,
          maxToolCalls: 5,
          maxFanouts: 1,
          timeoutMs: 30000
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`);
    }
    
    // Process streaming response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    if (!reader) {
      throw new Error('No response body');
    }
    
    console.log('Streaming started...\n');
    console.log('=' .repeat(80));
    
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
            
            // Display different types of messages
            if (data.type === 'reasoning' || data.type === 'debug') {
              console.log(`\n🧠 [DEBUG] ${data.message}`);
            } else if (data.type === 'status') {
              console.log(`\n📍 [STATUS] ${data.message}`);
            } else if (data.type === 'info') {
              console.log(`\nℹ️  [INFO] ${data.message}`);
            } else if (data.type === 'warning') {
              console.log(`\n⚠️  [WARNING] ${data.message}`);
            } else if (data.type === 'error') {
              console.log(`\n❌ [ERROR] ${data.message}`);
              if (data.error) console.log(`   Details: ${data.error}`);
            } else if (data.type === 'result') {
              console.log('\n' + '=' .repeat(80));
              console.log('📊 FINAL RESULT:');
              console.log('=' .repeat(80));
              
              if (data.pattern) {
                console.log(`\n✅ Pattern Found:`);
                console.log(`   Statement: ${data.pattern.pattern_name || data.pattern.statement}`);
                console.log(`   Confidence: ${data.pattern.confidence}%`);
                console.log(`   Type: ${data.pattern.pattern_type || data.pattern.type || 'unknown'}`);
              }
              
              if (data.metrics) {
                console.log(`\n📈 Metrics:`);
                console.log(`   Total Cost: $${data.metrics.totalCost || 0}`);
                console.log(`   Duration: ${data.metrics.totalDuration || 0}s`);
                console.log(`   Tool Calls: ${data.metrics.toolCallCount || 0}`);
              }
              
              if (data.budgetUsage) {
                console.log(`\n💰 Budget Usage:`);
                console.log(`   Tokens: ${data.budgetUsage.tokens || 0}`);
                console.log(`   Tool Calls: ${data.budgetUsage.toolCalls || 0}`);
              }
            } else if (data.type === 'complete') {
              console.log('\n' + '=' .repeat(80));
              console.log(`✅ ${data.message}`);
              console.log('=' .repeat(80));
            }
          } catch (e) {
            console.error('Failed to parse streaming data:', e);
            console.log('Raw line:', line);
          }
        }
      }
    }
    
    console.log('\nStreaming completed successfully!');
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
console.log('Starting agentic mode streaming test...');
console.log('Make sure the Next.js dev server is running on http://localhost:3000\n');

testAgenticStreaming().catch(console.error);