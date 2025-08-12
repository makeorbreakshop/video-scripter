/**
 * GPT-5 Working Implementation using the Responses API
 * Based on official OpenAI Cookbook documentation
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Test GPT-5 using the new Responses API
 * According to docs, GPT-5 uses client.responses.create() not chat.completions.create()
 */
async function testGPT5ResponsesAPI(input, options = {}) {
  const {
    model = 'gpt-5-nano',
    reasoningEffort = 'medium',
    verbosity = 'medium'
  } = options;
  
  console.log(`\n🧪 Testing GPT-5 with Responses API`);
  console.log(`Model: ${model}`);
  console.log(`Reasoning Effort: ${reasoningEffort}`);
  console.log(`Verbosity: ${verbosity}`);
  console.log('-'.repeat(50));
  
  try {
    // Try the Responses API format from the cookbook
    const response = await openai.responses.create({
      model: model,
      input: input,
      reasoning: {
        effort: reasoningEffort  // "minimal", "medium", "high"
      },
      text: {
        verbosity: verbosity  // "low", "medium", "high"
      }
    });
    
    console.log('✅ Success with Responses API!');
    console.log('Response:', response);
    
    return response;
    
  } catch (error) {
    console.log(`❌ Responses API error: ${error.message}`);
    
    // If Responses API doesn't exist, try the alternative format
    console.log('\n🔄 Trying alternative format...');
    
    try {
      const altResponse = await openai.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: input }],
        max_completion_tokens: 200,
        // Try adding the new parameters in different ways
        reasoning_effort: reasoningEffort,
        verbosity: verbosity
      });
      
      const content = altResponse.choices[0].message.content;
      
      if (content) {
        console.log('✅ Alternative format worked!');
        console.log('Content:', content);
      } else {
        console.log('⚠️ Still empty response');
        console.log('Reasoning tokens:', altResponse.usage?.completion_tokens_details?.reasoning_tokens);
      }
      
      return altResponse;
      
    } catch (altError) {
      console.log(`❌ Alternative format error: ${altError.message}`);
      
      // Try with nested structure
      console.log('\n🔄 Trying nested parameter structure...');
      
      try {
        const nestedResponse = await openai.chat.completions.create({
          model: model,
          messages: [{ role: 'user', content: input }],
          max_completion_tokens: 200,
          model_kwargs: {
            reasoning: { effort: reasoningEffort },
            text: { verbosity: verbosity }
          }
        });
        
        const content = nestedResponse.choices[0].message.content;
        console.log(content ? '✅ Nested structure worked!' : '⚠️ Still empty');
        if (content) console.log('Content:', content);
        
        return nestedResponse;
        
      } catch (nestedError) {
        console.log(`❌ Nested structure error: ${nestedError.message}`);
        return null;
      }
    }
  }
}

/**
 * Test vision capabilities with GPT-5
 */
async function testGPT5Vision(imageUrl, prompt) {
  console.log('\n🖼️ Testing GPT-5 Vision Capabilities');
  console.log('=' .repeat(50));
  
  // Test different API structures for vision
  const testFormats = [
    {
      name: 'Responses API with image',
      request: async () => {
        return await openai.responses.create({
          model: 'gpt-5-nano',
          input: {
            text: prompt,
            images: [imageUrl]
          },
          reasoning: { effort: 'minimal' },
          text: { verbosity: 'low' }
        });
      }
    },
    {
      name: 'Chat API with correct params',
      request: async () => {
        return await openai.chat.completions.create({
          model: 'gpt-5-nano',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }],
          max_completion_tokens: 100,
          reasoning_effort: 'minimal',
          verbosity: 'low'
        });
      }
    },
    {
      name: 'Chat API with stop parameter removed',
      request: async () => {
        // Based on research, stop parameters can cause empty responses
        return await openai.chat.completions.create({
          model: 'gpt-5-nano',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }],
          max_completion_tokens: 100
          // No stop parameter, no temperature (unsupported)
        });
      }
    }
  ];
  
  for (const format of testFormats) {
    console.log(`\n📝 Testing: ${format.name}`);
    
    try {
      const response = await format.request();
      
      // Check different response structures
      const content = response.choices?.[0]?.message?.content || 
                     response.text || 
                     response.output ||
                     response.content;
      
      if (content) {
        console.log('✅ Got content!');
        console.log('Response:', content);
        return { format: format.name, content, response };
      } else {
        console.log('⚠️ Empty response');
        if (response.usage) {
          console.log('Tokens:', response.usage);
        }
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
  }
  
  return null;
}

/**
 * Test all reasoning effort levels
 */
async function testReasoningLevels() {
  console.log('\n🧠 Testing Reasoning Effort Levels');
  console.log('=' .repeat(50));
  
  const levels = ['minimal', 'medium', 'high'];
  const prompt = 'What color is best for a YouTube thumbnail? Answer in one sentence.';
  
  for (const level of levels) {
    console.log(`\nTesting ${level} reasoning:`);
    
    try {
      // Try the documented approach
      const response = await openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 50,
        reasoning_effort: level
      });
      
      const content = response.choices[0].message.content;
      const tokens = response.usage?.completion_tokens || 0;
      const reasoningTokens = response.usage?.completion_tokens_details?.reasoning_tokens || 0;
      
      console.log(`- Content: ${content || '(empty)'}`);
      console.log(`- Total tokens: ${tokens}`);
      console.log(`- Reasoning tokens: ${reasoningTokens}`);
      
    } catch (error) {
      console.log(`- Error: ${error.message}`);
    }
  }
}

/**
 * Test verbosity levels
 */
async function testVerbosityLevels() {
  console.log('\n💬 Testing Verbosity Levels');
  console.log('=' .repeat(50));
  
  const levels = ['low', 'medium', 'high'];
  const prompt = 'Explain YouTube thumbnails.';
  
  for (const level of levels) {
    console.log(`\nTesting ${level} verbosity:`);
    
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 200,
        verbosity: level,
        reasoning_effort: 'minimal'  // Minimize reasoning to isolate verbosity
      });
      
      const content = response.choices[0].message.content;
      const tokens = response.usage?.completion_tokens || 0;
      
      if (content) {
        const wordCount = content.split(/\s+/).length;
        console.log(`- Words: ${wordCount}`);
        console.log(`- Tokens: ${tokens}`);
        console.log(`- Preview: ${content.substring(0, 100)}...`);
      } else {
        console.log(`- Empty response (${tokens} reasoning tokens)`);
      }
      
    } catch (error) {
      console.log(`- Error: ${error.message}`);
    }
  }
}

/**
 * Main test runner
 */
async function runComprehensiveGPT5Test() {
  console.log('🚀 GPT-5 COMPREHENSIVE TEST WITH RESPONSES API');
  console.log('=' .repeat(60));
  console.log('Based on OpenAI Cookbook Documentation\n');
  
  // Test 1: Basic Responses API
  console.log('\n' + '=' .repeat(60));
  console.log('TEST 1: RESPONSES API');
  console.log('=' .repeat(60));
  
  await testGPT5ResponsesAPI('What makes a great YouTube thumbnail? One sentence.');
  
  // Test 2: Reasoning levels
  console.log('\n' + '=' .repeat(60));
  console.log('TEST 2: REASONING LEVELS');
  console.log('=' .repeat(60));
  
  await testReasoningLevels();
  
  // Test 3: Verbosity levels
  console.log('\n' + '=' .repeat(60));
  console.log('TEST 3: VERBOSITY LEVELS');
  console.log('=' .repeat(60));
  
  await testVerbosityLevels();
  
  // Test 4: Vision with thumbnail
  console.log('\n' + '=' .repeat(60));
  console.log('TEST 4: VISION ANALYSIS');
  console.log('=' .repeat(60));
  
  const { data: video } = await supabase
    .from('videos')
    .select('*')
    .gte('temporal_performance_score', 10)
    .not('thumbnail_url', 'is', null)
    .limit(1)
    .single();
  
  if (video) {
    console.log(`Video: "${video.title}"`);
    await testGPT5Vision(
      video.thumbnail_url,
      'What makes this thumbnail effective? One sentence.'
    );
  }
  
  // Test 5: Try different combinations
  console.log('\n' + '=' .repeat(60));
  console.log('TEST 5: PARAMETER COMBINATIONS');
  console.log('=' .repeat(60));
  
  const combinations = [
    { reasoning: 'minimal', verbosity: 'low', desc: 'Fast & Brief' },
    { reasoning: 'minimal', verbosity: 'high', desc: 'Fast & Detailed' },
    { reasoning: 'high', verbosity: 'low', desc: 'Deep & Brief' },
    { reasoning: 'high', verbosity: 'high', desc: 'Deep & Detailed' }
  ];
  
  for (const combo of combinations) {
    console.log(`\n📊 Testing ${combo.desc}:`);
    await testGPT5ResponsesAPI(
      'How do thumbnails affect video performance?',
      {
        model: 'gpt-5-nano',
        reasoningEffort: combo.reasoning,
        verbosity: combo.verbosity
      }
    );
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('📊 CONCLUSIONS');
  console.log('=' .repeat(60));
  
  console.log('\n🔍 Key Findings:');
  console.log('1. GPT-5 may use a new Responses API (client.responses.create)');
  console.log('2. Parameters: reasoning.effort and text.verbosity');
  console.log('3. If Responses API not available, use max_completion_tokens');
  console.log('4. Avoid stop parameters that can cause empty responses');
  console.log('5. Temperature and top_p are unsupported with reasoning models');
  
  console.log('\n💡 Next Steps:');
  console.log('1. Check if OpenAI SDK supports responses.create()');
  console.log('2. Monitor for SDK updates that add Responses API');
  console.log('3. Use Chat API with max_completion_tokens as fallback');
  console.log('4. Test with minimal reasoning effort for faster responses');
}

// Run the test
runComprehensiveGPT5Test().catch(console.error);