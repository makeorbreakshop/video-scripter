#!/usr/bin/env node
/**
 * Test script to verify OpenAI Responses API fixes
 * Tests the core improvements without running full agentic mode
 */

import { config } from 'dotenv';
import OpenAI from 'openai';

config();

async function testOpenAIResponses() {
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('❌ No OpenAI API key - skipping test');
    return;
  }

  console.log('🧪 Testing OpenAI Responses API Integration...\n');

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  // Test 1: Basic Responses API call
  console.log('1. Testing basic Responses API call...');
  try {
    const response = await client.responses.create({
      model: 'gpt-5',
      input: 'What is 2+2? Respond in one word.',
      reasoning: { effort: 'minimal' },
      text: { verbosity: 'low' }
    });
    
    console.log('✅ Basic call works');
    console.log('   Response ID:', response.id?.substring(0, 20) + '...');
    console.log('   Output:', (response.output_text || response.output || '').substring(0, 50));
    console.log('   Usage:', response.usage ? {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      total: (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0)
    } : 'No usage data');
  } catch (error) {
    console.log('❌ Basic call failed:', error.message);
    return;
  }

  console.log('');

  // Test 2: Function tools format
  console.log('2. Testing function tools format...');
  try {
    const tools = [
      {
        type: 'function',
        name: 'test_tool',  // Name at root level
        description: 'A test tool for verification',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          },
          required: ['query']
        }
      }
    ];

    const response = await client.responses.create({
      model: 'gpt-5-mini',
      input: 'Please call the test_tool with query "hello world"',
      reasoning: { effort: 'medium' },
      text: { verbosity: 'medium' },
      tools: tools,
      tool_choice: 'required'
    });
    
    console.log('✅ Tool format accepted');
    console.log('   Tool calls found:', response.tool_calls ? response.tool_calls.length : 0);
    
    // Check different locations for tool calls
    if (response.tool_calls && response.tool_calls.length > 0) {
      console.log('   Tool call format:', {
        name: response.tool_calls[0].name,
        hasFunction: !!response.tool_calls[0].function
      });
    } else if (response.choices && response.choices[0]?.message?.tool_calls) {
      console.log('   Found in choices.message.tool_calls');
    } else if (Array.isArray(response.output)) {
      console.log('   Checking output array for tool calls...');
    } else {
      console.log('   No tool calls detected - checking output text');
      const outputText = response.output_text || response.output || '';
      console.log('   Output contains "test_tool":', outputText.includes('test_tool'));
    }
    
  } catch (error) {
    console.log('❌ Function tools failed:', error.message);
    if (error.message.includes('tool_choice')) {
      console.log('   Issue: tool_choice parameter problem');
    }
    if (error.message.includes('tools[0].name')) {
      console.log('   Issue: tool format problem');
    }
  }

  console.log('');

  // Test 3: JSON Schema Response Format
  console.log('3. Testing JSON schema response format...');
  try {
    const jsonSchema = {
      name: 'test_response',
      schema: {
        type: 'object',
        properties: {
          result: { type: 'string' },
          confidence: { type: 'number' }
        },
        required: ['result', 'confidence'],
        additionalProperties: false
      }
    };

    const response = await client.responses.create({
      model: 'gpt-5',
      input: 'Generate a test response with result "success" and confidence 0.9',
      reasoning: { effort: 'low' },
      text: { 
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'test_response',
          schema: jsonSchema.schema,
          strict: true
        }
      }
    });
    
    console.log('✅ JSON schema works');
    const output = response.output_text || response.output;
    try {
      const parsed = JSON.parse(output);
      console.log('   Parsed result:', parsed);
      console.log('   Valid schema:', typeof parsed.result === 'string' && typeof parsed.confidence === 'number');
    } catch (e) {
      console.log('   ❌ Could not parse as JSON:', output?.substring(0, 100));
    }
    
  } catch (error) {
    console.log('❌ JSON schema failed:', error.message);
  }

  console.log('\n🎉 OpenAI Responses API testing complete!');
}

// Run test
testOpenAIResponses().catch(console.error);