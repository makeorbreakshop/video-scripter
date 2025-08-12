/**
 * GPT-5 Testing with PROPER Token Allocation
 * Based on best practices research:
 * - GPT-5 supports up to 128K output tokens
 * - Default max for many models is 4096
 * - Should NOT artificially limit to 500
 * - Let model use what it needs
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testProperTokenAllocation() {
  console.log('🎯 GPT-5 PROPER TOKEN ALLOCATION TEST');
  console.log('='.repeat(60));
  console.log('Testing with realistic token allocations based on best practices');
  console.log('');
  
  const tests = [
    {
      name: 'Default allocation (4096 tokens)',
      prompt: 'Write a comprehensive guide on creating viral YouTube content. Include specific strategies, examples, and actionable tips.',
      tokens: 4096,
      reasoning_effort: 'minimal'
    },
    {
      name: 'Medium response (2000 tokens)',
      prompt: 'Explain the key factors that make YouTube videos go viral. Provide detailed analysis with examples.',
      tokens: 2000,
      reasoning_effort: 'minimal'
    },
    {
      name: 'Large response (8192 tokens)',
      prompt: 'Create a detailed YouTube channel growth strategy for a cooking channel. Include content calendar, thumbnail strategies, title formulas, audience engagement tactics, and monetization approaches. Be very comprehensive.',
      tokens: 8192,
      reasoning_effort: 'minimal'
    },
    {
      name: 'No limit specified (let model decide)',
      prompt: 'What are the top 3 YouTube thumbnail strategies?',
      tokens: null,  // Will not specify, let model use default
      reasoning_effort: 'minimal'
    },
    {
      name: 'Test without reasoning_effort parameter',
      prompt: 'List 5 YouTube video formats that get high engagement.',
      tokens: 2000,
      reasoning_effort: null  // Test without this parameter
    },
    {
      name: 'Test with reasoning_effort: low',
      prompt: 'Analyze why MrBeast videos are successful.',
      tokens: 4096,
      reasoning_effort: 'low'
    },
    {
      name: 'Test with reasoning_effort: medium',
      prompt: 'Compare YouTube Shorts vs regular videos for channel growth.',
      tokens: 4096,
      reasoning_effort: 'medium'
    }
  ];
  
  let successCount = 0;
  let totalCost = 0;
  const results = [];
  
  for (const test of tests) {
    console.log('\n' + '='.repeat(60));
    console.log(`TEST: ${test.name}`);
    if (test.tokens) {
      console.log(`Max completion tokens: ${test.tokens}`);
    } else {
      console.log(`Max completion tokens: (not specified - using model default)`);
    }
    if (test.reasoning_effort !== null) {
      console.log(`Reasoning effort: ${test.reasoning_effort}`);
    }
    console.log(`Prompt: "${test.prompt.substring(0, 80)}..."`);
    console.log('-'.repeat(60));
    
    try {
      const params = {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: test.prompt }]
      };
      
      // Only add max_completion_tokens if specified
      if (test.tokens) {
        params.max_completion_tokens = test.tokens;
      }
      
      // Only add reasoning_effort if specified
      if (test.reasoning_effort !== null) {
        params.reasoning_effort = test.reasoning_effort;
      }
      
      const startTime = Date.now();
      const response = await openai.chat.completions.create(params);
      const elapsed = Date.now() - startTime;
      
      const content = response.choices[0].message.content;
      const usage = response.usage;
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || 0;
      const visibleTokens = usage.completion_tokens - reasoningTokens;
      
      // Calculate cost (gpt-5-nano pricing)
      const cost = (usage.prompt_tokens * 0.05 / 1000000) + 
                   (usage.completion_tokens * 0.40 / 1000000);
      totalCost += cost;
      
      if (content) {
        successCount++;
        console.log('\n✅ SUCCESS - Got content!');
        console.log(`Response length: ${content.length} characters`);
        console.log(`Response preview: "${content.substring(0, 150)}..."`);
        console.log(`\nToken usage:`);
        console.log(`  - Prompt tokens: ${usage.prompt_tokens}`);
        console.log(`  - Total completion: ${usage.completion_tokens}`);
        console.log(`  - Reasoning tokens: ${reasoningTokens}`);
        console.log(`  - Visible tokens: ${visibleTokens}`);
        console.log(`  - Processing time: ${elapsed}ms`);
        console.log(`  - Cost: $${cost.toFixed(6)}`);
        
        results.push({
          test: test.name,
          success: true,
          responseLength: content.length,
          visibleTokens,
          reasoningTokens,
          time: elapsed,
          cost
        });
      } else {
        console.log('\n❌ EMPTY RESPONSE');
        console.log(`All ${usage.completion_tokens} tokens used for reasoning`);
        console.log(`Processing time: ${elapsed}ms`);
        console.log(`Cost: $${cost.toFixed(6)}`);
        
        results.push({
          test: test.name,
          success: false,
          reasoningTokens: usage.completion_tokens,
          time: elapsed,
          cost
        });
      }
      
    } catch (error) {
      console.log(`\n❌ ERROR: ${error.message}`);
      results.push({
        test: test.name,
        error: error.message
      });
    }
    
    // Wait between tests
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTS SUMMARY');
  console.log('='.repeat(60));
  
  const successRate = (successCount / tests.length * 100).toFixed(1);
  console.log(`\nSuccess Rate: ${successCount}/${tests.length} (${successRate}%)`);
  console.log(`Total Cost: $${totalCost.toFixed(4)}`);
  console.log(`Average Cost: $${(totalCost / tests.length).toFixed(5)} per request`);
  
  // Analyze patterns
  const successfulTests = results.filter(r => r.success);
  if (successfulTests.length > 0) {
    const avgTokens = successfulTests.reduce((sum, r) => sum + r.visibleTokens, 0) / successfulTests.length;
    const avgTime = successfulTests.reduce((sum, r) => sum + r.time, 0) / successfulTests.length;
    const avgResponseLength = successfulTests.reduce((sum, r) => sum + r.responseLength, 0) / successfulTests.length;
    
    console.log(`\nSuccessful Responses Analysis:`);
    console.log(`- Average visible tokens: ${avgTokens.toFixed(0)}`);
    console.log(`- Average response length: ${avgResponseLength.toFixed(0)} characters`);
    console.log(`- Average response time: ${avgTime.toFixed(0)}ms`);
  }
  
  console.log('\n💡 KEY FINDINGS:');
  console.log('Based on OpenAI best practices research:');
  console.log('1. GPT-5 supports up to 128K output tokens (much more than 500!)');
  console.log('2. Default max_completion_tokens is often 4096 for many models');
  console.log('3. You should NOT artificially limit tokens to low values like 500');
  console.log('4. reasoning_effort: "minimal" appears to be key for visible output');
  console.log('5. Let the model use the tokens it needs for proper responses');
  
  console.log('\n✅ RECOMMENDED CONFIGURATION:');
  console.log(`
const response = await openai.chat.completions.create({
  model: 'gpt-5-nano',
  messages: [{ role: 'user', content: 'Your prompt here' }],
  max_completion_tokens: 4096,     // Standard default, or omit to let model decide
  reasoning_effort: 'minimal'       // Critical for getting visible output
});
`);
}

// Run the test
testProperTokenAllocation().catch(console.error);