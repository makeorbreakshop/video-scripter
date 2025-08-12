/**
 * GPT-5 Systematic Test
 * Goal: Understand exactly why empty responses occur and find the solution
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Test results collection
const testResults = {
  timestamp: new Date().toISOString(),
  tests: [],
  summary: {}
};

/**
 * Test 1: Basic parameter combinations
 */
async function testParameterCombinations() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: PARAMETER COMBINATIONS');
  console.log('='.repeat(60));
  
  const combinations = [
    // Test with max_tokens (old parameter)
    {
      name: 'Old style with max_tokens',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Say "hello"' }],
        max_tokens: 10
      }
    },
    // Test with max_completion_tokens (new parameter)
    {
      name: 'New style with max_completion_tokens',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Say "hello"' }],
        max_completion_tokens: 10
      }
    },
    // Test with reasoning_effort variations
    {
      name: 'reasoning_effort: undefined (default)',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Say "hello"' }],
        max_completion_tokens: 10
      }
    },
    {
      name: 'reasoning_effort: minimal',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Say "hello"' }],
        max_completion_tokens: 10,
        reasoning_effort: 'minimal'
      }
    },
    {
      name: 'reasoning_effort: low',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Say "hello"' }],
        max_completion_tokens: 10,
        reasoning_effort: 'low'
      }
    },
    {
      name: 'reasoning_effort: medium',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Say "hello"' }],
        max_completion_tokens: 10,
        reasoning_effort: 'medium'
      }
    },
    {
      name: 'reasoning_effort: high',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Say "hello"' }],
        max_completion_tokens: 10,
        reasoning_effort: 'high'
      }
    }
  ];
  
  const results = [];
  
  for (const combo of combinations) {
    console.log(`\nTesting: ${combo.name}`);
    
    try {
      const response = await openai.chat.completions.create(combo.params);
      const content = response.choices[0].message.content;
      const usage = response.usage;
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || 0;
      
      const result = {
        test: combo.name,
        success: true,
        hasContent: !!content,
        content: content || '(empty)',
        totalTokens: usage.completion_tokens,
        reasoningTokens: reasoningTokens,
        visibleTokens: usage.completion_tokens - reasoningTokens
      };
      
      results.push(result);
      
      console.log(`  Content: ${content ? `"${content}"` : '(empty)'}`);
      console.log(`  Tokens: ${usage.completion_tokens} total (${reasoningTokens} reasoning, ${usage.completion_tokens - reasoningTokens} visible)`);
      
    } catch (error) {
      results.push({
        test: combo.name,
        success: false,
        error: error.message
      });
      console.log(`  Error: ${error.message}`);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  testResults.tests.push({ name: 'Parameter Combinations', results });
  return results;
}

/**
 * Test 2: Different prompt types
 */
async function testPromptTypes() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: PROMPT TYPES');
  console.log('='.repeat(60));
  
  const prompts = [
    { type: 'Simple command', content: 'Say hello' },
    { type: 'Direct output', content: 'Output: hello' },
    { type: 'JSON request', content: '{"message": "hello"}' },
    { type: 'Question', content: 'What is 2+2?' },
    { type: 'Completion', content: 'Complete this: The sky is' },
    { type: 'System + User', messages: [
      { role: 'system', content: 'You always respond with one word.' },
      { role: 'user', content: 'What color is the sky?' }
    ]},
    { type: 'Assistant context', messages: [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'Say that again' }
    ]}
  ];
  
  const results = [];
  
  for (const prompt of prompts) {
    console.log(`\nTesting: ${prompt.type}`);
    
    const messages = prompt.messages || [{ role: 'user', content: prompt.content }];
    
    // Test with minimal reasoning
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: messages,
        max_completion_tokens: 50,
        reasoning_effort: 'minimal'
      });
      
      const content = response.choices[0].message.content;
      const usage = response.usage;
      
      results.push({
        promptType: prompt.type,
        hasContent: !!content,
        content: content || '(empty)',
        tokens: usage.completion_tokens
      });
      
      console.log(`  Result: ${content ? `"${content}"` : '(empty)'}`);
      
    } catch (error) {
      results.push({
        promptType: prompt.type,
        error: error.message
      });
      console.log(`  Error: ${error.message}`);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  testResults.tests.push({ name: 'Prompt Types', results });
  return results;
}

/**
 * Test 3: Response format variations
 */
async function testResponseFormats() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: RESPONSE FORMATS');
  console.log('='.repeat(60));
  
  const formats = [
    {
      name: 'Default (no format)',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Say hello' }],
        max_completion_tokens: 10,
        reasoning_effort: 'minimal'
      }
    },
    {
      name: 'JSON mode',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Return JSON: {"greeting": "hello"}' }],
        max_completion_tokens: 50,
        response_format: { type: 'json_object' },
        reasoning_effort: 'minimal'
      }
    },
    {
      name: 'With temperature 0',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Say hello' }],
        max_completion_tokens: 10,
        temperature: 0,
        reasoning_effort: 'minimal'
      }
    },
    {
      name: 'With seed',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Say hello' }],
        max_completion_tokens: 10,
        seed: 12345,
        reasoning_effort: 'minimal'
      }
    }
  ];
  
  const results = [];
  
  for (const format of formats) {
    console.log(`\nTesting: ${format.name}`);
    
    try {
      const response = await openai.chat.completions.create(format.params);
      const content = response.choices[0].message.content;
      
      results.push({
        format: format.name,
        hasContent: !!content,
        content: content || '(empty)'
      });
      
      console.log(`  Result: ${content ? `"${content}"` : '(empty)'}`);
      
    } catch (error) {
      results.push({
        format: format.name,
        error: error.message
      });
      console.log(`  Error: ${error.message}`);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  testResults.tests.push({ name: 'Response Formats', results });
  return results;
}

/**
 * Test 4: Multiple attempts with same config
 */
async function testConsistency() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: CONSISTENCY CHECK');
  console.log('='.repeat(60));
  
  const config = {
    model: 'gpt-5-nano',
    messages: [{ role: 'user', content: 'Say hello' }],
    max_completion_tokens: 10,
    reasoning_effort: 'minimal'
  };
  
  console.log('Testing same config 10 times...');
  
  const results = [];
  let successCount = 0;
  let contentCount = 0;
  
  for (let i = 0; i < 10; i++) {
    try {
      const response = await openai.chat.completions.create(config);
      const content = response.choices[0].message.content;
      
      if (content) {
        contentCount++;
        console.log(`  Attempt ${i+1}: ✅ "${content}"`);
      } else {
        console.log(`  Attempt ${i+1}: ⚠️ (empty)`);
      }
      
      successCount++;
      results.push({ attempt: i+1, hasContent: !!content, content });
      
    } catch (error) {
      console.log(`  Attempt ${i+1}: ❌ ${error.message}`);
      results.push({ attempt: i+1, error: error.message });
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  const consistencyRate = (contentCount / successCount * 100).toFixed(1);
  console.log(`\nConsistency: ${contentCount}/${successCount} responses had content (${consistencyRate}%)`);
  
  testResults.tests.push({ 
    name: 'Consistency Check', 
    results,
    summary: { successCount, contentCount, consistencyRate }
  });
  
  return results;
}

/**
 * Test 5: Compare with GPT-4 to verify our approach
 */
async function testGPT4Comparison() {
  console.log('\n' + '='.repeat(60));
  console.log('TEST 5: GPT-4 COMPARISON');
  console.log('='.repeat(60));
  
  const prompt = 'Say hello';
  
  // Test GPT-4o-mini with standard params
  console.log('\nGPT-4o-mini:');
  try {
    const gpt4Response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 10
    });
    
    console.log(`  Content: "${gpt4Response.choices[0].message.content}"`);
    console.log(`  Tokens: ${gpt4Response.usage.completion_tokens}`);
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }
  
  // Test GPT-5-nano with our best config
  console.log('\nGPT-5-nano (best config):');
  try {
    const gpt5Response = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 10,
      reasoning_effort: 'minimal'
    });
    
    const content = gpt5Response.choices[0].message.content;
    console.log(`  Content: ${content ? `"${content}"` : '(empty)'}`);
    console.log(`  Tokens: ${gpt5Response.usage.completion_tokens}`);
    
    if (gpt5Response.usage.completion_tokens_details) {
      console.log(`  Reasoning tokens: ${gpt5Response.usage.completion_tokens_details.reasoning_tokens}`);
    }
  } catch (error) {
    console.log(`  Error: ${error.message}`);
  }
}

/**
 * Main test runner
 */
async function runSystematicTest() {
  console.log('🔬 GPT-5 SYSTEMATIC TEST');
  console.log('='.repeat(60));
  console.log('Objective: Understand why empty responses occur');
  console.log('Date:', new Date().toISOString());
  console.log('');
  
  // Run all tests
  await testParameterCombinations();
  await testPromptTypes();
  await testResponseFormats();
  await testConsistency();
  await testGPT4Comparison();
  
  // Analyze results
  console.log('\n' + '='.repeat(60));
  console.log('📊 ANALYSIS SUMMARY');
  console.log('='.repeat(60));
  
  // Find which configurations work
  const workingConfigs = [];
  const failingConfigs = [];
  
  for (const test of testResults.tests) {
    if (test.results) {
      for (const result of test.results) {
        if (result.hasContent) {
          workingConfigs.push(result);
        } else if (result.success !== false) {
          failingConfigs.push(result);
        }
      }
    }
  }
  
  console.log(`\n✅ Working configurations: ${workingConfigs.length}`);
  console.log(`❌ Empty responses: ${failingConfigs.length}`);
  
  // Pattern analysis
  console.log('\n🔍 Patterns Identified:');
  
  // Check if reasoning_effort matters
  const minimalWorks = workingConfigs.filter(c => c.test?.includes('minimal')).length;
  const otherWorks = workingConfigs.filter(c => !c.test?.includes('minimal')).length;
  
  if (minimalWorks > otherWorks) {
    console.log('- reasoning_effort: "minimal" produces more content');
  }
  
  // Save detailed results
  const filename = `data/gpt5_systematic_test_${new Date().toISOString().split('T')[0]}.json`;
  await fs.writeFile(filename, JSON.stringify(testResults, null, 2));
  console.log(`\n💾 Detailed results saved to: ${filename}`);
  
  // Final recommendations
  console.log('\n💡 RECOMMENDATIONS:');
  console.log('Based on systematic testing, here are the findings:');
  
  if (workingConfigs.length > 0) {
    console.log('1. GPT-5 CAN produce content with the right parameters');
    console.log('2. Key working configuration:');
    console.log('   - Use max_completion_tokens (not max_tokens)');
    console.log('   - Set reasoning_effort: "minimal" for visible content');
    console.log('3. Success rate varies - expect intermittent responses');
  } else {
    console.log('1. GPT-5 models appear to have issues with content generation');
    console.log('2. This may be an API rollout issue');
    console.log('3. Consider using fallback to GPT-4 models');
  }
}

// Run the test
runSystematicTest().catch(console.error);