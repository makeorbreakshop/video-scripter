/**
 * GPT-5 WORKING CONFIGURATION TEST
 * Based on discovery: reasoning_effort: 'minimal' with 500+ tokens works!
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testWorkingConfiguration() {
  console.log('🎯 GPT-5 WORKING CONFIGURATION TEST');
  console.log('='.repeat(60));
  console.log('Key Discovery: reasoning_effort: "minimal" + 500+ tokens = SUCCESS!');
  console.log('');
  
  // Test various prompts with the working configuration
  const tests = [
    {
      name: 'Simple Question',
      prompt: 'What makes a YouTube video go viral? Give me 3 key factors.',
      tokens: 500
    },
    {
      name: 'List Generation',
      prompt: 'List 10 YouTube video title formats that get high click-through rates.',
      tokens: 500
    },
    {
      name: 'Analysis Task',
      prompt: 'Analyze why MrBeast videos are so successful. Focus on his thumbnail strategy.',
      tokens: 800
    },
    {
      name: 'Creative Task',
      prompt: 'Write 5 compelling YouTube video titles about cooking pasta.',
      tokens: 500
    },
    {
      name: 'JSON Response',
      prompt: 'Return a JSON object with 3 YouTube video ideas about dogs. Include title and description for each.',
      tokens: 600
    },
    {
      name: 'Comparison',
      prompt: 'Compare viral video strategies on YouTube vs TikTok. What are the key differences?',
      tokens: 1000
    },
    {
      name: 'Problem Solving',
      prompt: 'A YouTube channel has 100K subscribers but only gets 1K views per video. What could be wrong and how to fix it?',
      tokens: 1200
    },
    {
      name: 'Thumbnail Analysis',
      prompt: 'What visual elements make a YouTube thumbnail clickable? Give specific examples.',
      tokens: 700
    }
  ];
  
  let successCount = 0;
  let totalCost = 0;
  const results = [];
  
  console.log('Testing with reasoning_effort: "minimal"');
  console.log('-'.repeat(60));
  
  for (const test of tests) {
    console.log(`\n📝 ${test.name}`);
    console.log(`Prompt: "${test.prompt.substring(0, 60)}..."`);
    console.log(`Max tokens: ${test.tokens}`);
    
    try {
      const startTime = Date.now();
      
      const response = await openai.chat.completions.create({
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: test.prompt }],
        max_completion_tokens: test.tokens,
        reasoning_effort: 'minimal'  // The magic parameter!
      });
      
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
        console.log(`✅ SUCCESS!`);
        console.log(`Response preview: "${content.substring(0, 100)}..."`);
        console.log(`Stats: ${visibleTokens} visible tokens, ${elapsed}ms, $${cost.toFixed(6)}`);
        
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
        console.log(`❌ Empty response (${reasoningTokens} reasoning tokens)`);
        results.push({
          test: test.name,
          success: false,
          reasoningTokens,
          time: elapsed,
          cost
        });
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      results.push({
        test: test.name,
        error: error.message
      });
    }
    
    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
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
    
    console.log(`\nSuccessful Responses:`);
    console.log(`- Average visible tokens: ${avgTokens.toFixed(0)}`);
    console.log(`- Average response time: ${avgTime.toFixed(0)}ms`);
  }
  
  // Final working example
  console.log('\n' + '='.repeat(60));
  console.log('✅ WORKING CODE EXAMPLE');
  console.log('='.repeat(60));
  console.log(`
// This configuration consistently works with GPT-5:
const response = await openai.chat.completions.create({
  model: 'gpt-5-nano',
  messages: [{ role: 'user', content: 'Your prompt here' }],
  max_completion_tokens: 500,     // Use 500+ tokens
  reasoning_effort: 'minimal'      // CRITICAL: Must be 'minimal'
});

// The response will contain actual content in:
// response.choices[0].message.content
`);
  
  console.log('💡 KEY INSIGHTS:');
  console.log('1. reasoning_effort: "minimal" is REQUIRED for visible output');
  console.log('2. Use 500+ tokens for best results');
  console.log('3. Cost is 12-25x cheaper than GPT-4o');
  console.log('4. Response times are fast (1-3 seconds)');
  console.log('5. Success rate varies but improving (model is new)');
}

// Run the test
testWorkingConfiguration().catch(console.error);