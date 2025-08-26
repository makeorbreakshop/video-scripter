/**
 * Debug test for Idea Heist - find out why it's using mock data
 */

import dotenv from 'dotenv';
dotenv.config();

import { IdeaHeistAgent } from './lib/agentic/orchestrator/idea-heist-agent.js';
import { isOpenAIConfigured } from './lib/agentic/openai-integration.js';
import { createClient } from '@supabase/supabase-js';

console.log('🔍 Environment Check:');
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `✅ Set (${process.env.OPENAI_API_KEY.substring(0, 10)}...)` : '❌ Missing');
console.log('- PINECONE_API_KEY:', process.env.PINECONE_API_KEY ? `✅ Set (${process.env.PINECONE_API_KEY.substring(0, 10)}...)` : '❌ Missing');
console.log('- isOpenAIConfigured():', isOpenAIConfigured());

// Test video
const videoId = 'eKxNGFjyRv0';

// Create Supabase client to verify video exists
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testAgent() {
  try {
    // First verify the video exists
    const { data: video, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, temporal_performance_score')
      .eq('id', videoId)
      .single();
    
    if (error || !video) {
      console.error('❌ Video not found:', error);
      return;
    }
    
    console.log('\n✅ Video found:', {
      title: video.title,
      channel: video.channel_name,
      tps: video.temporal_performance_score
    });
    
    // Create agent with debugging
    console.log('\n🚀 Starting agent...');
    const agent = new IdeaHeistAgent({
      mode: 'agentic',
      budget: {
        maxFanouts: 3,
        maxValidations: 10,
        maxCandidates: 50,
        maxTokens: 50000,
        maxDurationMs: 60000, // 1 minute for testing
        maxToolCalls: 20
      },
      timeoutMs: 60000
    });
    
    // Intercept console logs to see what's happening
    const originalLog = console.log;
    const logs = [];
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };
    
    // Run the agent
    const result = await agent.runIdeaHeistAgent(videoId);
    
    // Restore console.log
    console.log = originalLog;
    
    // Analyze results
    console.log('\n📊 Analysis Results:');
    console.log('- Success:', result.success);
    console.log('- Mode:', result.mode);
    console.log('- Fallback used:', result.fallbackUsed);
    
    if (result.pattern) {
      console.log('\n🎯 Pattern Found:');
      console.log('- Statement:', result.pattern.statement || result.pattern.pattern_name);
      console.log('- Confidence:', result.pattern.confidence);
      console.log('- Evidence count:', result.pattern.evidence?.length || 0);
      
      // Check if evidence is mock data
      if (result.pattern.evidence && result.pattern.evidence.length > 0) {
        const firstEvidence = result.pattern.evidence[0];
        const isMock = firstEvidence.videoId?.includes('rb-') || 
                       firstEvidence.videoId?.includes('-001') ||
                       firstEvidence.videoId?.includes('mock');
        
        if (isMock) {
          console.error('\n❌ MOCK DATA DETECTED IN EVIDENCE!');
          console.error('Example video IDs:', result.pattern.evidence.slice(0, 3).map(e => e.videoId));
        } else {
          console.log('\n✅ REAL DATA IN EVIDENCE!');
          console.log('Example video IDs:', result.pattern.evidence.slice(0, 3).map(e => e.videoId));
        }
      } else {
        console.warn('\n⚠️ No evidence found in pattern');
      }
    }
    
    console.log('\n📈 Metrics:');
    console.log('- Total duration:', result.metrics?.totalDurationMs || 0, 'ms');
    console.log('- Total tokens:', result.metrics?.totalTokens || 0);
    console.log('- Total cost: $', result.metrics?.totalCost || 0);
    console.log('- Tool calls:', result.metrics?.toolCallCount || 0);
    
    // Check logs for specific issues
    console.log('\n🔍 Debug Log Analysis:');
    const openaiLogs = logs.filter(l => l.includes('[OpenAI]'));
    const toolLogs = logs.filter(l => l.includes('Tool'));
    const mockLogs = logs.filter(l => l.includes('mock') || l.includes('Mock'));
    
    console.log('- OpenAI logs:', openaiLogs.length);
    console.log('- Tool logs:', toolLogs.length);
    console.log('- Mock references:', mockLogs.length);
    
    if (mockLogs.length > 0) {
      console.warn('\n⚠️ Mock mode references found:');
      mockLogs.slice(0, 3).forEach(l => console.log('  -', l.substring(0, 100)));
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack:', error.stack);
  }
}

testAgent();