/**
 * Test GPT-5 models to discover correct parameters
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testParameters() {
  console.log('🧪 Testing GPT-5 Parameter Variations\n');
  
  const testMessage = {
    role: 'user',
    content: 'Say "Hello GPT-5" in exactly 3 words.'
  };
  
  // Test different parameter combinations
  const parameterTests = [
    {
      name: 'Standard (max_tokens)',
      params: {
        model: 'gpt-5-nano',
        messages: [testMessage],
        max_tokens: 20
      }
    },
    {
      name: 'With max_output_tokens',
      params: {
        model: 'gpt-5-nano',
        messages: [testMessage],
        max_output_tokens: 20
      }
    },
    {
      name: 'With max_completion_tokens',
      params: {
        model: 'gpt-5-nano',
        messages: [testMessage],
        max_completion_tokens: 20
      }
    },
    {
      name: 'With reasoning_effort',
      params: {
        model: 'gpt-5-nano',
        messages: [testMessage],
        max_tokens: 20,
        reasoning_effort: 'minimal'
      }
    },
    {
      name: 'With verbosity',
      params: {
        model: 'gpt-5-nano',
        messages: [testMessage],
        max_tokens: 20,
        verbosity: 'low'
      }
    },
    {
      name: 'With both reasoning and verbosity',
      params: {
        model: 'gpt-5-nano',
        messages: [testMessage],
        max_tokens: 20,
        reasoning_effort: 'minimal',
        verbosity: 'low'
      }
    }
  ];
  
  for (const test of parameterTests) {
    console.log(`\n📝 Test: ${test.name}`);
    console.log(`Parameters:`, JSON.stringify(test.params, null, 2));
    
    try {
      const response = await openai.chat.completions.create(test.params);
      
      console.log(`✅ Success!`);
      console.log(`Response: "${response.choices[0].message.content}"`);
      console.log(`Model: ${response.model}`);
      console.log(`Usage:`, response.usage);
      
      // Check if reasoning tokens are reported
      if (response.usage?.reasoning_tokens) {
        console.log(`Reasoning tokens: ${response.usage.reasoning_tokens}`);
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      if (error.response?.data?.error?.message) {
        console.log(`Details: ${error.response.data.error.message}`);
      }
    }
  }
  
  // Test with a real thumbnail analysis
  console.log('\n\n🖼️ Testing Thumbnail Analysis with GPT-5-nano');
  console.log('=' .repeat(50));
  
  try {
    const visionTest = {
      model: 'gpt-5-nano',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What makes this thumbnail effective? Be brief.'
          },
          {
            type: 'image_url',
            image_url: {
              url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', // Rick Astley
              detail: 'high'
            }
          }
        ]
      }],
      max_tokens: 100
    };
    
    console.log('Testing vision capabilities...');
    const response = await openai.chat.completions.create(visionTest);
    
    console.log(`✅ Vision test successful!`);
    console.log(`Response: ${response.choices[0].message.content}`);
    console.log(`Tokens used:`, response.usage);
    
    // Calculate cost
    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    const cost = (inputTokens * 0.05 / 1000000) + (outputTokens * 0.40 / 1000000);
    console.log(`💰 Cost: $${cost.toFixed(6)}`);
    
  } catch (error) {
    console.log(`❌ Vision test failed: ${error.message}`);
  }
  
  // Compare models
  console.log('\n\n🔄 Comparing GPT-5 Models');
  console.log('=' .repeat(50));
  
  const models = ['gpt-5-nano', 'gpt-5-mini'];
  const testPrompt = {
    role: 'user',
    content: 'What is the key to viral YouTube thumbnails? Answer in one sentence.'
  };
  
  for (const model of models) {
    console.log(`\n📊 Model: ${model}`);
    
    try {
      const startTime = Date.now();
      const response = await openai.chat.completions.create({
        model: model,
        messages: [testPrompt],
        max_tokens: 50
      });
      
      const processingTime = Date.now() - startTime;
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      
      // Get pricing
      const pricing = {
        'gpt-5-nano': { input: 0.05, output: 0.40 },
        'gpt-5-mini': { input: 0.25, output: 2.0 },
        'gpt-5': { input: 1.25, output: 10.0 }
      };
      
      const modelPricing = pricing[model] || pricing['gpt-5-nano'];
      const cost = (inputTokens * modelPricing.input / 1000000) + 
                   (outputTokens * modelPricing.output / 1000000);
      
      console.log(`Response: ${response.choices[0].message.content}`);
      console.log(`Time: ${processingTime}ms`);
      console.log(`Tokens: ${inputTokens} in, ${outputTokens} out`);
      console.log(`Cost: $${cost.toFixed(6)}`);
      
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }
}

testParameters().catch(console.error);