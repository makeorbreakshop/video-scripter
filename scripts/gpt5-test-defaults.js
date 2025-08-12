/**
 * Test GPT-5 DEFAULT token behavior
 * What happens when we DON'T specify max_completion_tokens at all?
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testDefaultTokenBehavior() {
  console.log('🔍 TESTING GPT-5 DEFAULT TOKEN BEHAVIOR');
  console.log('='.repeat(60));
  console.log('What happens when we DON\'T specify max_completion_tokens?');
  console.log('');
  
  const tests = [
    {
      name: 'No max_completion_tokens specified',
      prompt: 'Write a comprehensive guide to creating viral YouTube content. Include strategies, examples, and actionable tips.',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: null }],  // Will set content
        reasoning_effort: 'minimal'
        // NO max_completion_tokens!
      }
    },
    {
      name: 'Simple prompt, no token limit',
      prompt: 'List 5 YouTube video formats.',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: null }],
        reasoning_effort: 'minimal'
        // NO max_completion_tokens!
      }
    },
    {
      name: 'Complex prompt, no token limit',
      prompt: `Create a detailed YouTube channel growth strategy for a cooking channel. Include:
1. Content calendar for 30 days
2. Thumbnail design principles
3. Title formulas that work
4. Audience engagement tactics
5. Monetization approaches
Be very comprehensive and detailed.`,
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: null }],
        reasoning_effort: 'minimal'
        // NO max_completion_tokens!
      }
    }
  ];
  
  for (const test of tests) {
    console.log('\n' + '='.repeat(60));
    console.log(`TEST: ${test.name}`);
    console.log(`Prompt preview: "${test.prompt.substring(0, 80)}..."`);
    console.log('-'.repeat(60));
    
    // Set the content
    test.params.messages[0].content = test.prompt;
    
    try {
      const startTime = Date.now();
      const response = await openai.chat.completions.create(test.params);
      const elapsed = Date.now() - startTime;
      
      const content = response.choices[0].message.content;
      const usage = response.usage;
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || 0;
      const visibleTokens = usage.completion_tokens - reasoningTokens;
      
      if (content) {
        console.log('\n✅ SUCCESS - Got content!');
        console.log(`Response length: ${content.length} characters`);
        console.log(`Response preview: "${content.substring(0, 150)}..."`);
        
        console.log(`\n📊 Token Usage (NO LIMIT SPECIFIED):`);
        console.log(`  - Prompt tokens: ${usage.prompt_tokens}`);
        console.log(`  - Completion tokens: ${usage.completion_tokens}`);
        console.log(`  - Visible tokens: ${visibleTokens}`);
        console.log(`  - Reasoning tokens: ${reasoningTokens}`);
        console.log(`  - Processing time: ${elapsed}ms`);
        
        // This is the key insight - what's the actual default?
        console.log(`\n💡 INSIGHT: Model used ${usage.completion_tokens} tokens without limit`);
        
      } else {
        console.log('\n❌ EMPTY RESPONSE');
        console.log(`Tokens used: ${usage.completion_tokens} (all reasoning)`);
      }
      
    } catch (error) {
      console.log(`\n❌ ERROR: ${error.message}`);
      // Check if error mentions a default
      if (error.message.includes('max_completion_tokens')) {
        console.log('📝 Error mentions max_completion_tokens!');
      }
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('💡 FINDINGS:');
  console.log('When max_completion_tokens is not specified:');
  console.log('- Model determines its own limit');
  console.log('- Actual usage varies based on prompt complexity');
  console.log('- No explicit "default" value - it\'s dynamic!');
}

// Run the test
testDefaultTokenBehavior().catch(console.error);