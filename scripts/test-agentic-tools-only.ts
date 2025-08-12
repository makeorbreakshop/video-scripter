#!/usr/bin/env npx tsx
/**
 * TEST: Are tools being called now?
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function testToolCalling() {
  console.log('\n🧪 TESTING TOOL CALLS WITH UPDATED PROMPTS\n');
  
  const videoId = 'U5GHwG3_RAo';
  
  try {
    const response = await fetch('http://localhost:3000/api/idea-heist/agentic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        options: {
          maxFanoutRequests: 2,
          maxValidationRounds: 1,
          maxSearchRounds: 1,
          maxCandidates: 10,
          timeoutSeconds: 60
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    let toolCallCount = 0;
    let mockDataFound = false;
    let realDataFound = false;
    
    console.log('Monitoring for tool calls...\n');
    
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'tool_call') {
              toolCallCount++;
              console.log(`✅ TOOL CALL #${toolCallCount}: ${data.tool}`);
              
              if (data.result) {
                const resultStr = JSON.stringify(data.result);
                if (resultStr.includes('mock-') || resultStr.includes('rb-')) {
                  mockDataFound = true;
                  console.log('   ❌ Mock data returned');
                } else if (resultStr.includes('video_id') || resultStr.includes('results')) {
                  realDataFound = true;
                  console.log('   ✅ Real data returned');
                }
              }
            } else if (data.type === 'turn_complete' && data.turn === 'search_planning') {
              console.log(`\n📊 Search Planning Complete:`);
              console.log(`   Tool calls made: ${toolCallCount}`);
              
              if (toolCallCount === 0) {
                console.log('   ❌ NO TOOLS CALLED - Still broken!');
              } else if (mockDataFound && !realDataFound) {
                console.log('   ⚠️  Only mock data returned');
              } else if (realDataFound) {
                console.log('   ✅ Real tool execution working!');
              }
              
              // Exit early after search planning
              process.exit(toolCallCount > 0 && realDataFound ? 0 : 1);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testToolCalling();