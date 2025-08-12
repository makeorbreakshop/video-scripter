/**
 * GPT-5 Testing with OpenAI Cookbook Best Practices
 * Based on: https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide
 * 
 * Key learnings:
 * 1. Default reasoning_effort is "medium" (not minimal)
 * 2. Break complex tasks across multiple turns for peak performance
 * 3. Responses API recommended for better agentic flows
 * 4. Control "agentic eagerness" with reasoning_effort
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testCookbookBestPractices() {
  console.log('🎯 GPT-5 COOKBOOK BEST PRACTICES TEST');
  console.log('='.repeat(60));
  console.log('Testing based on official OpenAI Cookbook guidance');
  console.log('');
  
  const tests = [
    {
      name: 'Default (no reasoning_effort specified)',
      description: 'Cookbook says default is "medium", not minimal',
      prompt: 'Analyze why MrBeast videos go viral. Focus on thumbnail strategy.',
      tokens: 4096,
      reasoning_effort: undefined  // Let it use default
    },
    {
      name: 'Simple task with minimal reasoning',
      description: 'For simple tasks, lower reasoning reduces overhead',
      prompt: 'List 5 popular YouTube video formats.',
      tokens: 1000,
      reasoning_effort: 'minimal'
    },
    {
      name: 'Complex task with high reasoning',
      description: 'Complex multi-step tasks benefit from higher reasoning',
      prompt: `Analyze this YouTube channel growth problem step by step:
      
A cooking channel has 100K subscribers but only gets 1K views per video.
1. Identify potential causes
2. Prioritize them by likelihood
3. Suggest specific solutions for each
4. Create a 30-day action plan`,
      tokens: 8192,
      reasoning_effort: 'high'
    },
    {
      name: 'Task with clear stop conditions',
      description: 'Cookbook recommends defining clear task boundaries',
      prompt: `Generate exactly 3 YouTube video titles about cooking pasta.
      
Requirements:
- Each title must be 50-60 characters
- Include a number or superlative
- Stop after generating exactly 3 titles`,
      tokens: 500,
      reasoning_effort: 'low'
    },
    {
      name: 'Multi-turn simulation (Turn 1)',
      description: 'Peak performance with task decomposition',
      prompt: 'Step 1: List the top 3 factors that make YouTube thumbnails clickable.',
      tokens: 1000,
      reasoning_effort: 'medium'
    }
  ];
  
  let successCount = 0;
  let totalCost = 0;
  const results = [];
  
  for (const test of tests) {
    console.log('\n' + '='.repeat(60));
    console.log(`TEST: ${test.name}`);
    console.log(`Description: ${test.description}`);
    console.log(`Reasoning effort: ${test.reasoning_effort || '(default - should be medium)'}`);
    console.log(`Max tokens: ${test.tokens}`);
    console.log(`Prompt preview: "${test.prompt.substring(0, 60)}..."`);
    console.log('-'.repeat(60));
    
    try {
      const params = {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: test.prompt }],
        max_completion_tokens: test.tokens
      };
      
      // Only add reasoning_effort if explicitly defined
      if (test.reasoning_effort !== undefined) {
        params.reasoning_effort = test.reasoning_effort;
      }
      
      const startTime = Date.now();
      const response = await openai.chat.completions.create(params);
      const elapsed = Date.now() - startTime;
      
      const content = response.choices[0].message.content;
      const usage = response.usage;
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || 0;
      const visibleTokens = usage.completion_tokens - reasoningTokens;
      
      // Calculate cost
      const cost = (usage.prompt_tokens * 0.05 / 1000000) + 
                   (usage.completion_tokens * 0.40 / 1000000);
      totalCost += cost;
      
      if (content) {
        successCount++;
        console.log('\n✅ SUCCESS - Got content!');
        console.log(`Response length: ${content.length} characters`);
        
        // Show first 200 chars of response
        console.log(`\nResponse preview:`);
        console.log(`"${content.substring(0, 200)}..."`);
        
        console.log(`\nToken breakdown:`);
        console.log(`  - Prompt tokens: ${usage.prompt_tokens}`);
        console.log(`  - Visible tokens: ${visibleTokens}`);
        console.log(`  - Reasoning tokens: ${reasoningTokens}`);
        console.log(`  - Reasoning ratio: ${(reasoningTokens / usage.completion_tokens * 100).toFixed(1)}%`);
        console.log(`  - Processing time: ${elapsed}ms`);
        console.log(`  - Cost: $${cost.toFixed(6)}`);
        
        results.push({
          test: test.name,
          success: true,
          responseLength: content.length,
          visibleTokens,
          reasoningTokens,
          reasoningRatio: reasoningTokens / usage.completion_tokens,
          time: elapsed,
          cost
        });
      } else {
        console.log('\n❌ EMPTY RESPONSE');
        console.log(`All ${usage.completion_tokens} tokens used for reasoning`);
        console.log(`Processing time: ${elapsed}ms`);
        
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
  
  // Multi-turn test continuation
  console.log('\n' + '='.repeat(60));
  console.log('MULTI-TURN TEST (Turn 2)');
  console.log('Description: Continue from previous response');
  console.log('-'.repeat(60));
  
  try {
    // Simulate continuing from a previous turn
    const messages = [
      { role: 'user', content: 'Step 1: List the top 3 factors that make YouTube thumbnails clickable.' },
      { role: 'assistant', content: '1. Strong emotional expressions (faces)\n2. Bold contrasting colors\n3. Clear focal point with minimal clutter' },
      { role: 'user', content: 'Step 2: For each factor, provide a specific example from a successful YouTube channel.' }
    ];
    
    const response = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: messages,
      max_completion_tokens: 2000,
      reasoning_effort: 'medium'
    });
    
    if (response.choices[0].message.content) {
      console.log('✅ Multi-turn continuation successful');
      console.log(`Response: "${response.choices[0].message.content.substring(0, 150)}..."`);
    }
  } catch (error) {
    console.log(`❌ Multi-turn error: ${error.message}`);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESULTS SUMMARY');
  console.log('='.repeat(60));
  
  const successRate = (successCount / tests.length * 100).toFixed(1);
  console.log(`\nSuccess Rate: ${successCount}/${tests.length} (${successRate}%)`);
  console.log(`Total Cost: $${totalCost.toFixed(4)}`);
  
  // Analyze reasoning patterns
  const successfulTests = results.filter(r => r.success);
  if (successfulTests.length > 0) {
    console.log('\n🔍 Reasoning Token Analysis:');
    
    const byEffort = {
      undefined: [],
      minimal: [],
      low: [],
      medium: [],
      high: []
    };
    
    tests.forEach((test, i) => {
      if (results[i]?.success) {
        const effort = test.reasoning_effort || 'undefined';
        byEffort[effort].push(results[i].reasoningRatio || 0);
      }
    });
    
    for (const [effort, ratios] of Object.entries(byEffort)) {
      if (ratios.length > 0) {
        const avg = (ratios.reduce((a, b) => a + b, 0) / ratios.length * 100).toFixed(1);
        console.log(`  - ${effort === 'undefined' ? 'default (medium)' : effort}: ${avg}% reasoning tokens`);
      }
    }
  }
  
  console.log('\n💡 KEY INSIGHTS FROM COOKBOOK:');
  console.log('1. Default reasoning_effort="medium" works well for most tasks');
  console.log('2. Higher reasoning effort = more reasoning tokens (by design)');
  console.log('3. Break complex tasks into multiple turns for best results');
  console.log('4. Clear task boundaries reduce unnecessary reasoning');
  console.log('5. Consider Responses API for persisting reasoning across calls');
}

// Run the test
testCookbookBestPractices().catch(console.error);