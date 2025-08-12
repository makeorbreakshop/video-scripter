/**
 * Simple test of OpenAI integration
 */

import dotenv from 'dotenv';
dotenv.config();

async function testOpenAIIntegration() {
  console.log('🧪 Testing OpenAI integration...');
  
  try {
    // Import the integration
    const { openaiIntegration, isOpenAIConfigured } = await import('./lib/agentic/openai-integration.js');
    
    console.log('✅ OpenAI integration imported');
    console.log('🔑 OpenAI configured:', isOpenAIConfigured());
    
    // Test a simple hypothesis generation
    console.log('🤖 Testing hypothesis generation...');
    
    const hypothesis = await openaiIntegration.generateHypothesis(
      'You are analyzing viral video patterns.',
      {
        title: 'Test video',
        tps: 3.5,
        channelName: 'Test Channel',
        formatType: 'tutorial',
        topicNiche: 'music'
      },
      'gpt-5'
    );
    
    console.log('✅ Hypothesis generated:', hypothesis);
    
  } catch (error) {
    console.error('❌ OpenAI integration test failed:', error);
    console.error('Stack:', error.stack);
  }
}

testOpenAIIntegration();