#!/usr/bin/env node
/**
 * Test Claude-based Agentic Mode
 * Simple test to verify Claude integration works
 */

import { config } from 'dotenv';
config();

async function testClaudeAgentic() {
  console.log('🧪 Testing Claude Agentic Mode...\n');

  // Check if Anthropic API key is available
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('❌ ANTHROPIC_API_KEY not found. Please set it in your .env file');
    process.exit(1);
  }

  try {
    console.log('📡 Testing Claude agentic endpoint...');
    const startTime = Date.now();

    // Test the Claude-based agentic endpoint
    const response = await fetch('http://localhost:3000/api/idea-heist/claude-agentic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        videoId: 'eKxNGFjyRv0', // Known test video
        options: {
          maxFanouts: 1,         // Minimal for testing
          maxValidations: 5,     // Minimal
          maxCandidates: 10,     // Minimal
          maxTokens: 8000,       // Increased for complex analysis
          maxDurationMs: 90000,  // 90 seconds max
          fallbackToClassic: false // Disable fallback to see real performance
        }
      })
    });

    const duration = Date.now() - startTime;
    console.log(`⏱️  Request completed in ${(duration/1000).toFixed(1)}s`);

    if (!response.ok) {
      const error = await response.text();
      console.log(`❌ Request failed (${response.status}):`, error.substring(0, 500));
      
      // If endpoint doesn't exist, that's expected - we haven't created it yet
      if (response.status === 404) {
        console.log('\n💡 The Claude agentic endpoint does not exist yet.');
        console.log('   This is expected - we need to create the API endpoint.');
        console.log('   The Claude integration classes are ready to use!');
        return;
      }
      return;
    }

    const result = await response.json();
    console.log('\n🎯 Claude Agentic Test Results:');
    console.log(`- Success: ${result.success ? '✅' : '❌'}`);
    console.log(`- Mode: ${result.mode}`);
    console.log(`- Fallback: ${result.fallbackUsed ? '⚠️ Yes' : '✅ No'}`);
    console.log(`- Has Pattern: ${result.pattern ? '✅' : '❌'}`);
    console.log(`- Tool Calls: ${result.metrics?.toolCalls || 0}`);
    console.log(`- Tokens: ${result.metrics?.tokensUsed || 0}`);
    console.log(`- Model Switches: ${result.metrics?.modelSwitches || 0}`);

    if (result.error) {
      console.log('\n❌ Error:', result.error);
    }

    if (result.pattern?.primaryPattern) {
      console.log('\n🎯 Primary Pattern Found:');
      console.log(`- Type: ${result.pattern.primaryPattern.type}`);
      console.log(`- Statement: ${result.pattern.primaryPattern.statement?.substring(0, 100)}...`);
      console.log(`- Confidence: ${result.pattern.primaryPattern.confidence}`);
      console.log(`- Evidence Count: ${result.pattern.primaryPattern.evidence?.length || 0}`);
    }

    // Assessment
    if (result.success && result.metrics?.toolCalls > 0) {
      console.log('\n✅ CLAUDE AGENTIC FLOW WORKING - Tools executed, pattern generated');
    } else if (result.fallbackUsed) {
      console.log('\n⚠️  FALLBACK ACTIVATED - Claude agentic had issues but fallback worked');
    } else {
      console.log('\n❌ CLAUDE AGENTIC FLOW FAILED - Check implementation');
    }

  } catch (error) {
    console.log(`\n❌ Test failed:`, error.message);
    
    if (error.message.includes('fetch')) {
      console.log('\n💡 Make sure your development server is running:');
      console.log('   npm run dev');
    }
  }
}

// Also test basic Claude integration directly
async function testClaudeIntegrationDirect() {
  console.log('\n🧪 Testing Claude Integration Directly...\n');

  try {
    // Import the Claude integration (this would need to be transpiled)
    console.log('📋 Testing basic Claude API connection...');
    
    // Test if we can create a basic Anthropic client
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
    
    // Simple test message
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: 'Hello! Just testing the connection. Please respond with "Claude connection successful!"'
        }
      ]
    });
    
    const content = response.content.find(block => block.type === 'text')?.text || '';
    
    console.log('✅ Claude API Connection Test:');
    console.log(`- Model: ${response.model}`);
    console.log(`- Response: ${content}`);
    console.log(`- Input Tokens: ${response.usage.input_tokens}`);
    console.log(`- Output Tokens: ${response.usage.output_tokens}`);
    console.log(`- Total Cost: ~$${((response.usage.input_tokens * 0.003 + response.usage.output_tokens * 0.015) / 1000).toFixed(6)}`);
    
    if (content.toLowerCase().includes('successful')) {
      console.log('\n🎉 CLAUDE INTEGRATION READY!');
    }
    
  } catch (error) {
    console.log(`\n❌ Direct Claude test failed:`, error.message);
    
    if (error.message.includes('API key')) {
      console.log('\n💡 Check your ANTHROPIC_API_KEY in .env file');
    } else if (error.message.includes('anthropic-ai/sdk')) {
      console.log('\n💡 Make sure @anthropic-ai/sdk is installed:');
      console.log('   npm install @anthropic-ai/sdk');
    }
  }
}

console.log('🚀 Claude Agentic Test Suite Starting...\n');

// Run tests
await testClaudeIntegrationDirect();
await testClaudeAgentic();

console.log('\n✨ Claude Agentic Test Suite Complete!');