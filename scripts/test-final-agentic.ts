#!/usr/bin/env npx tsx
/**
 * FINAL TEST - Complete agentic flow with real data
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function finalTest() {
  console.log('\n🎯 FINAL TEST - AGENTIC MODE WITH REAL DATA\n');
  
  const videoId = 'U5GHwG3_RAo';
  const startTime = Date.now();
  
  // Move stats outside try block
  let stats = {
    toolCalls: 0,
    realData: 0,
    mockData: 0,
    turns: 0
  };
  
  console.log('Configuration:');
  console.log('- Video ID:', videoId);
  console.log('- OpenAI API:', process.env.OPENAI_API_KEY ? '✅' : '❌');
  console.log('- Pinecone API:', process.env.PINECONE_API_KEY ? '✅' : '❌');
  console.log('- Supabase:', process.env.SUPABASE_URL ? '✅' : '❌');
  console.log('');
  
  try {
    // Call the agentic API
    const response = await fetch('http://localhost:3000/api/idea-heist/agentic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        options: {
          maxFanoutRequests: 1,
          maxValidationRounds: 1,
          maxSearchRounds: 1,
          maxCandidates: 5,
          timeoutSeconds: 30
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    console.log('Monitoring execution:\n');
    
    const timeout = setTimeout(() => {
      console.log('\n⏱️ 30 second timeout reached');
      printSummary();
      process.exit(1);
    }, 30000);
    
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
              stats.toolCalls++;
              console.log(`🔧 Tool call #${stats.toolCalls}: ${data.tool}`);
              
              if (data.result) {
                const resultStr = JSON.stringify(data.result);
                if (resultStr.includes('mock-') || resultStr.includes('rb-')) {
                  stats.mockData++;
                  console.log('   ❌ Mock data');
                } else if (resultStr.includes('video_id') || resultStr.includes('id')) {
                  stats.realData++;
                  console.log('   ✅ Real data');
                }
              }
            } else if (data.type === 'turn_complete') {
              stats.turns++;
              console.log(`\n📍 Turn ${stats.turns} complete: ${data.turn}`);
            } else if (data.type === 'complete') {
              clearTimeout(timeout);
              console.log('\n✅ Analysis complete!');
              
              if (data.result?.pattern) {
                console.log('\n📊 Pattern discovered:');
                console.log(`"${data.result.pattern.statement}"`);
                console.log(`Confidence: ${data.result.pattern.confidence}%`);
                
                // Check evidence quality
                if (data.result.pattern.evidence) {
                  const mockEvidence = data.result.pattern.evidence.filter((e: any) =>
                    e.video_id?.startsWith('mock-') || e.video_id?.startsWith('rb-')
                  ).length;
                  
                  console.log(`Evidence: ${data.result.pattern.evidence.length} videos`);
                  console.log(`Real evidence: ${data.result.pattern.evidence.length - mockEvidence}`);
                  console.log(`Mock evidence: ${mockEvidence}`);
                }
              }
              
              printSummary();
              process.exit(0);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    
    clearTimeout(timeout);
    printSummary();
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
  
  function printSummary() {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '='.repeat(50));
    console.log('SUMMARY');
    console.log('='.repeat(50));
    console.log(`Duration: ${duration}s`);
    console.log(`Turns completed: ${stats.turns}`);
    console.log(`Tool calls made: ${stats.toolCalls}`);
    console.log(`Real data returned: ${stats.realData}`);
    console.log(`Mock data returned: ${stats.mockData}`);
    
    if (stats.toolCalls === 0) {
      console.log('\n❌ FAILED: No tools were called');
    } else if (stats.mockData > 0 && stats.realData === 0) {
      console.log('\n❌ FAILED: Only mock data returned');
    } else if (stats.realData > 0) {
      console.log('\n✅ SUCCESS: Real tool execution working!');
    }
    console.log('='.repeat(50));
  }
}

finalTest();