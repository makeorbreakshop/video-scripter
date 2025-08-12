#!/usr/bin/env node
/**
 * Real end-to-end test of agentic mode with actual video data
 */

import fetch from 'node-fetch';
import { config } from 'dotenv';

config();

async function testRealAgenticMode() {
  console.log('🧪 Testing Real Agentic Mode with Video Data...\n');

  // Check environment
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasPinecone = Boolean(process.env.PINECONE_API_KEY);
  const hasSupabase = Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);

  console.log('🔍 Environment Check:');
  console.log(`- OPENAI_API_KEY: ${hasOpenAI ? '✅ Set' : '❌ Missing'}`);
  console.log(`- PINECONE_API_KEY: ${hasPinecone ? '✅ Set' : '❌ Missing'}`);
  console.log(`- SUPABASE_URL: ${hasSupabase ? '✅ Set' : '❌ Missing'}`);

  if (!hasOpenAI || !hasPinecone || !hasSupabase) {
    console.log('\n❌ Missing required environment variables');
    return;
  }

  // Test video ID (from your logs - a high-performing video)
  const testVideoId = 'eKxNGFjyRv0'; // "I'm Sorry...This New Artist Completely Sucks" - 185x TPS
  console.log(`\n📺 Testing with video: ${testVideoId}`);

  try {
    console.log('\n🚀 Starting agentic analysis...');
    const startTime = Date.now();

    const response = await fetch('http://localhost:3000/api/idea-heist/agentic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId: testVideoId,
        options: {
          maxFanouts: 2,         // Reduced for testing
          maxValidations: 10,    // Reduced for testing
          maxCandidates: 50,     // Reduced for testing
          maxTokens: 50000,      // Reduced for testing
          maxDurationMs: 120000, // 2 minutes max
          fallbackToClassic: true
        }
      })
    });

    const duration = Date.now() - startTime;
    console.log(`\n⏱️  Analysis completed in ${(duration/1000).toFixed(1)}s`);

    if (!response.ok) {
      const error = await response.text();
      console.log(`❌ Request failed (${response.status}):`, error);
      return;
    }

    const result = await response.json();
    console.log('\n📊 Analysis Result:');
    console.log(`- Success: ${result.success ? '✅' : '❌'}`);
    console.log(`- Mode: ${result.mode}`);
    console.log(`- Fallback Used: ${result.fallbackUsed ? '⚠️ Yes' : '✅ No'}`);

    if (result.pattern) {
      console.log(`\n🎯 Pattern Discovered:`);
      console.log(`- Statement: "${result.pattern.statement}"`);
      console.log(`- Confidence: ${result.pattern.confidence}`);
      console.log(`- Validations: ${result.pattern.validations || 0}`);
      console.log(`- Evidence: ${result.pattern.evidence?.length || 0} items`);
      console.log(`- Niches: ${result.pattern.niches?.length || 0} niches`);
    } else {
      console.log('\n❌ No pattern discovered');
    }

    if (result.metrics) {
      console.log(`\n📈 Metrics:`);
      console.log(`- Tool Calls: ${result.metrics.toolCalls || 0}`);
      console.log(`- Tokens Used: ${result.metrics.tokensUsed || 0}`);
      console.log(`- Duration: ${result.metrics.durationMs ? (result.metrics.durationMs/1000).toFixed(1) : 0}s`);
      console.log(`- Cost: $${result.metrics.totalCost || 0}`);
    }

    if (result.budgetUsage) {
      console.log(`\n💰 Budget Usage:`);
      console.log(`- Fanouts: ${result.budgetUsage.fanouts || 0}/2`);
      console.log(`- Validations: ${result.budgetUsage.validations || 0}/10`);
      console.log(`- Candidates: ${result.budgetUsage.candidates || 0}/50`);
      console.log(`- Tool Calls: ${result.budgetUsage.toolCalls || 0}/100`);
    }

    // Check for real data vs mock data
    console.log(`\n🔍 Data Quality Check:`);
    if (result.pattern?.evidence) {
      const hasRealVideoIds = result.pattern.evidence.some(e => 
        e.videoId && e.videoId.length === 11 && !e.videoId.startsWith('mock')
      );
      console.log(`- Real Video IDs: ${hasRealVideoIds ? '✅ Found' : '❌ Mock data detected'}`);
      
      if (result.pattern.evidence.length > 0) {
        const firstEvidence = result.pattern.evidence[0];
        console.log(`- Sample Evidence: ${firstEvidence.videoId} - "${firstEvidence.title?.substring(0, 50)}..."`);
      }
    } else {
      console.log('- Evidence: ❌ No evidence found');
    }

    // Check if we have UI-compatible structure
    console.log(`\n🖥️  UI Compatibility:`);
    console.log(`- source_video: ${result.source_video ? '✅' : '❌'}`);
    console.log(`- validation: ${result.validation ? '✅' : '❌'}`);
    console.log(`- debug: ${result.debug ? '✅' : '❌'}`);

    if (result.error) {
      console.log(`\n❌ Error Details:`, result.error);
    }

    // Overall assessment
    console.log(`\n🎯 Overall Assessment:`);
    const isRealData = result.pattern?.evidence?.some(e => 
      e.videoId && !e.videoId.startsWith('mock') && !e.videoId.startsWith('rb-')
    );
    const hasToolCalls = (result.metrics?.toolCalls || 0) > 0;
    const hasValidations = (result.pattern?.validations || 0) > 0;
    
    if (result.success && isRealData && hasToolCalls) {
      console.log('✅ AGENTIC MODE WORKING - Real data, real tool calls, pattern discovered');
    } else if (result.success && result.fallbackUsed) {
      console.log('⚠️  FALLBACK TO CLASSIC - Agentic failed but classic succeeded');
    } else if (!isRealData) {
      console.log('❌ STILL USING MOCK DATA - Tool calling not working properly');
    } else {
      console.log('❌ ANALYSIS FAILED - Check logs for details');
    }

  } catch (error) {
    console.log(`\n❌ Test failed:`, error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('💡 Make sure the development server is running: npm run dev');
    }
  }
}

// Run the test
testRealAgenticMode().catch(console.error);