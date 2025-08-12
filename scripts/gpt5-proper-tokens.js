/**
 * GPT-5 Test with PROPER Token Allocation
 * Testing with realistic token limits (500-2000)
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testGPT5WithProperTokens() {
  console.log('🚀 GPT-5 TEST WITH PROPER TOKEN ALLOCATION');
  console.log('='.repeat(60));
  console.log('Testing with realistic token limits (500-2000 tokens)\n');
  
  const tests = [
    {
      name: 'Simple task with 500 tokens',
      prompt: 'Explain what makes a great YouTube thumbnail in 3 bullet points.',
      tokens: 500
    },
    {
      name: 'Medium task with 1000 tokens',
      prompt: 'Write a detailed analysis of why videos go viral on YouTube. Include at least 5 key factors.',
      tokens: 1000
    },
    {
      name: 'Complex task with 2000 tokens',
      prompt: `Analyze the following scenario and provide recommendations:
      
A YouTube channel about cooking has 50,000 subscribers but their videos only get 1,000 views on average. 
What could be wrong and how can they improve? Provide a comprehensive strategy.`,
      tokens: 2000
    },
    {
      name: 'Quick response with reasoning_effort minimal',
      prompt: 'List 5 popular YouTube video formats.',
      tokens: 500,
      reasoning_effort: 'minimal'
    },
    {
      name: 'Detailed response with reasoning_effort high',
      prompt: 'Explain the psychology behind viral content and how creators can leverage it.',
      tokens: 1500,
      reasoning_effort: 'high'
    }
  ];
  
  for (const test of tests) {
    console.log('\n' + '='.repeat(60));
    console.log(`TEST: ${test.name}`);
    console.log(`Tokens: ${test.tokens}`);
    console.log(`Prompt: "${test.prompt.substring(0, 100)}..."`);
    console.log('-'.repeat(60));
    
    try {
      const params = {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: test.prompt }],
        max_completion_tokens: test.tokens
      };
      
      // Add reasoning_effort if specified
      if (test.reasoning_effort) {
        params.reasoning_effort = test.reasoning_effort;
        console.log(`Reasoning effort: ${test.reasoning_effort}`);
      }
      
      const startTime = Date.now();
      const response = await openai.chat.completions.create(params);
      const elapsed = Date.now() - startTime;
      
      const content = response.choices[0].message.content;
      const usage = response.usage;
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || 0;
      const visibleTokens = usage.completion_tokens - reasoningTokens;
      
      if (content) {
        console.log('\n✅ SUCCESS - Got content!');
        console.log(`Response length: ${content.length} characters`);
        console.log(`Response preview: "${content.substring(0, 200)}..."`);
        console.log(`\nToken usage:`);
        console.log(`  - Total completion: ${usage.completion_tokens}`);
        console.log(`  - Reasoning tokens: ${reasoningTokens}`);
        console.log(`  - Visible tokens: ${visibleTokens}`);
        console.log(`  - Processing time: ${elapsed}ms`);
        
        // Calculate cost
        const cost = (usage.prompt_tokens * 0.05 / 1000000) + 
                     (usage.completion_tokens * 0.40 / 1000000);
        console.log(`  - Cost: $${cost.toFixed(6)}`);
        
      } else {
        console.log('\n❌ EMPTY RESPONSE');
        console.log(`All ${usage.completion_tokens} tokens used for reasoning`);
        console.log(`Processing time: ${elapsed}ms`);
      }
      
    } catch (error) {
      console.log(`\n❌ ERROR: ${error.message}`);
    }
    
    // Wait between tests
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Also test with different models
  console.log('\n' + '='.repeat(60));
  console.log('TESTING DIFFERENT GPT-5 MODELS');
  console.log('='.repeat(60));
  
  const models = ['gpt-5-nano', 'gpt-5-mini'];
  const testPrompt = 'Write a comprehensive guide on creating viral YouTube content. Include specific strategies, examples, and actionable tips.';
  
  for (const model of models) {
    console.log(`\nTesting ${model}:`);
    
    try {
      const response = await openai.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: testPrompt }],
        max_completion_tokens: 1500
      });
      
      const content = response.choices[0].message.content;
      const usage = response.usage;
      
      if (content) {
        console.log(`✅ SUCCESS - Got ${content.length} characters`);
        console.log(`Tokens: ${usage.completion_tokens} (${usage.completion_tokens_details?.reasoning_tokens || 0} reasoning)`);
        
        // Calculate cost based on model
        const pricing = {
          'gpt-5-nano': { input: 0.05, output: 0.40 },
          'gpt-5-mini': { input: 0.25, output: 2.00 }
        };
        const cost = (usage.prompt_tokens * pricing[model].input / 1000000) + 
                     (usage.completion_tokens * pricing[model].output / 1000000);
        console.log(`Cost: $${cost.toFixed(5)}`);
      } else {
        console.log(`❌ Empty response (${usage.completion_tokens} reasoning tokens)`);
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Final test: Compare with GPT-4
  console.log('\n' + '='.repeat(60));
  console.log('COMPARISON WITH GPT-4o-mini');
  console.log('='.repeat(60));
  
  const comparisonPrompt = 'What are the top 5 factors that make a YouTube video go viral?';
  
  // GPT-5-nano
  console.log('\nGPT-5-nano (1000 tokens):');
  try {
    const gpt5Response = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [{ role: 'user', content: comparisonPrompt }],
      max_completion_tokens: 1000
    });
    
    const content = gpt5Response.choices[0].message.content;
    console.log(content ? `✅ Got ${content.length} chars` : '❌ Empty');
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  // GPT-4o-mini
  console.log('\nGPT-4o-mini (1000 tokens):');
  try {
    const gpt4Response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: comparisonPrompt }],
      max_tokens: 1000  // Note: uses max_tokens, not max_completion_tokens
    });
    
    const content = gpt4Response.choices[0].message.content;
    console.log(`✅ Got ${content.length} chars`);
    console.log(`Preview: "${content.substring(0, 200)}..."`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log('\nKey findings will be displayed based on results above.');
}

// Run the test
testGPT5WithProperTokens().catch(console.error);