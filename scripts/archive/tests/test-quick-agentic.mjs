#!/usr/bin/env node
/**
 * Quick test of agentic mode fixes
 */

import fetch from 'node-fetch';
import { config } from 'dotenv';

config();

async function quickAgenticTest() {
  console.log('⚡ Quick Agentic Test...\n');

  try {
    console.log('📡 Testing agentic endpoint...');
    const startTime = Date.now();

    const response = await fetch('http://localhost:3000/api/idea-heist/agentic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId: 'eKxNGFjyRv0',
        options: {
          maxFanouts: 1,         // Minimal for quick test
          maxValidations: 5,     // Minimal
          maxCandidates: 10,     // Minimal
          maxTokens: 5000,       // Minimal
          maxDurationMs: 30000,  // 30 seconds max
          fallbackToClassic: true
        }
      })
    });

    const duration = Date.now() - startTime;
    console.log(`⏱️  Request completed in ${(duration/1000).toFixed(1)}s`);

    if (!response.ok) {
      const error = await response.text();
      console.log(`❌ Request failed (${response.status}):`, error.substring(0, 300));
      return;
    }

    const result = await response.json();
    console.log('\n🎯 Quick Results:');
    console.log(`- Success: ${result.success ? '✅' : '❌'}`);
    console.log(`- Mode: ${result.mode}`);
    console.log(`- Fallback: ${result.fallbackUsed ? '⚠️ Yes' : '✅ No'}`);
    console.log(`- Has Pattern: ${result.pattern ? '✅' : '❌'}`);
    console.log(`- Tool Calls: ${result.metrics?.toolCalls || 0}`);
    console.log(`- Tokens: ${result.metrics?.tokensUsed || 0}`);

    if (result.error) {
      console.log('\n❌ Error:', result.error);
    }

    // Quick assessment
    if (result.success && result.metrics?.toolCalls > 0) {
      console.log('\n✅ BASIC AGENTIC FLOW WORKING - Tools executed, result generated');
    } else if (result.fallbackUsed) {
      console.log('\n⚠️  FALLBACK ACTIVATED - Agentic had issues but fallback worked');
    } else {
      console.log('\n❌ AGENTIC FLOW FAILED - Check implementation');
    }

  } catch (error) {
    console.log(`\n❌ Test failed:`, error.message);
  }
}

quickAgenticTest().catch(console.error);