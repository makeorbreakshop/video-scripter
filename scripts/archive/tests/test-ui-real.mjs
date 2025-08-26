#!/usr/bin/env node

/**
 * Real UI Requirements Test
 * Tests the actual streaming endpoint with native fetch
 */

const BASE_URL = 'http://localhost:3000';

async function testUIRequirements() {
  console.log('🚀 Testing Actual UI Requirements');
  console.log('=' .repeat(60));
  
  const testVideoId = 'Y-Z4fjwMPsU';
  const url = `${BASE_URL}/api/idea-heist/agentic-v2`;
  
  console.log(`\n📡 POST to: ${url}`);
  console.log(`📝 Video ID: ${testVideoId}\n`);
  
  const receivedTypes = new Set();
  const messages = [];
  let passed = 0;
  let failed = 0;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: testVideoId,
        mode: 'agentic',
        options: {
          maxTokens: 10000,
          maxToolCalls: 20,
          maxFanouts: 5,
          timeoutMs: 30000  // 30 second timeout
        }
      })
    });
    
    // Check content type
    const contentType = response.headers.get('content-type');
    if (contentType === 'text/event-stream') {
      console.log('✅ Content-Type: text/event-stream');
      passed++;
    } else {
      console.log(`❌ Content-Type: ${contentType} (expected text/event-stream)`);
      failed++;
    }
    
    // Read stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let messageCount = 0;
    
    const startTime = Date.now();
    const timeout = 35000; // 35 seconds
    
    console.log('\n📨 Streaming messages:');
    console.log('-'.repeat(40));
    
    while (true) {
      if (Date.now() - startTime > timeout) {
        console.log('\n⏱️ Timeout reached (35s limit for test)');
        break;
      }
      
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          messageCount++;
          
          try {
            const data = JSON.parse(line.slice(6));
            messages.push(data);
            receivedTypes.add(data.type);
            
            // Log each message type
            const preview = data.message ? 
              `: ${data.message.substring(0, 40)}${data.message.length > 40 ? '...' : ''}` : '';
            console.log(`  ${messageCount}. [${data.type}]${preview}`);
            
            // Check for complete
            if (data.type === 'complete') {
              console.log('\n✅ Received complete message');
              passed++;
              
              // Check result structure
              if (data.result && data.result.version && data.result.summary_md) {
                console.log('✅ Valid structured output format');
                passed++;
              } else {
                console.log('❌ Invalid result structure');
                failed++;
              }
              
              if (data.logFile) {
                console.log(`📁 Log file: ${data.logFile}`);
              }
              
              // Exit early on complete
              reader.cancel();
              break;
            }
            
          } catch (error) {
            console.log(`  ${messageCount}. ❌ Invalid JSON: ${error.message}`);
            failed++;
          }
        }
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    failed++;
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTS');
  console.log('='.repeat(60));
  
  console.log(`\n📨 Total messages: ${messages.length}`);
  console.log(`📝 Message types: ${Array.from(receivedTypes).join(', ')}`);
  
  // Check critical types
  const criticalTypes = ['video_found', 'complete'];
  const hasCritical = criticalTypes.every(type => receivedTypes.has(type));
  
  if (hasCritical) {
    console.log('✅ All critical message types received');
    passed++;
  } else {
    const missing = criticalTypes.filter(type => !receivedTypes.has(type));
    console.log(`❌ Missing critical types: ${missing.join(', ')}`);
    failed++;
  }
  
  // Check for hypothesis
  const hasHypothesis = messages.some(m => 
    m.type === 'reasoning' && m.message && 
    (m.message.includes('Hypothesis') || m.message.includes('hypothesis'))
  );
  
  if (hasHypothesis) {
    console.log('✅ Hypothesis found in reasoning');
    passed++;
  } else {
    console.log('⚠️  No hypothesis found (may be in timeout)');
  }
  
  console.log(`\n✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  
  if (failed === 0) {
    console.log('\n🎉 UI requirements working correctly!');
  } else {
    console.log('\n⚠️  Some issues detected');
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run test
testUIRequirements();