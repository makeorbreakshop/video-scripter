/**
 * GPT-5 Final Test - Finding the exact working configuration
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testConfigurations() {
  console.log('🧪 GPT-5 CONFIGURATION TESTING\n');
  
  const testPrompt = 'What color is best for YouTube thumbnails? Answer in exactly one sentence.';
  
  const configurations = [
    {
      name: 'Config 1: reasoning_effort as string',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: testPrompt }],
        max_completion_tokens: 50,
        reasoning_effort: 'minimal'
      }
    },
    {
      name: 'Config 2: reasoning_effort in extra_body',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: testPrompt }],
        max_completion_tokens: 50,
        extra_body: {
          reasoning_effort: 'minimal'
        }
      }
    },
    {
      name: 'Config 3: No reasoning_effort',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: testPrompt }],
        max_completion_tokens: 50
      }
    },
    {
      name: 'Config 4: With response_format',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Output JSON: {"color": "best color for thumbnails"}' }],
        max_completion_tokens: 50,
        response_format: { type: 'json_object' },
        reasoning_effort: 'minimal'
      }
    },
    {
      name: 'Config 5: System message approach',
      params: {
        model: 'gpt-5-nano',
        messages: [
          { role: 'system', content: 'You always respond in one sentence.' },
          { role: 'user', content: testPrompt }
        ],
        max_completion_tokens: 50,
        reasoning_effort: 'minimal'
      }
    },
    {
      name: 'Config 6: Very short max_completion_tokens',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Say "hello"' }],
        max_completion_tokens: 5,
        reasoning_effort: 'minimal'
      }
    },
    {
      name: 'Config 7: Direct question',
      params: {
        model: 'gpt-5-nano',
        messages: [{ role: 'user', content: 'Red or blue?' }],
        max_completion_tokens: 10,
        reasoning_effort: 'minimal'
      }
    }
  ];
  
  const results = [];
  
  for (const config of configurations) {
    console.log(`\n📝 Testing: ${config.name}`);
    console.log('Parameters:', JSON.stringify(config.params, null, 2));
    
    try {
      const startTime = Date.now();
      const response = await openai.chat.completions.create(config.params);
      const processingTime = Date.now() - startTime;
      
      const content = response.choices[0].message.content;
      const usage = response.usage;
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || 0;
      
      const result = {
        config: config.name,
        success: !!content,
        content: content || '(empty)',
        processingTime,
        tokens: {
          completion: usage.completion_tokens,
          reasoning: reasoningTokens,
          visible: usage.completion_tokens - reasoningTokens
        }
      };
      
      results.push(result);
      
      if (content) {
        console.log(`✅ SUCCESS! Got content: "${content}"`);
        console.log(`Tokens: ${usage.completion_tokens} total (${reasoningTokens} reasoning, ${usage.completion_tokens - reasoningTokens} visible)`);
      } else {
        console.log(`❌ Empty response`);
        console.log(`All ${usage.completion_tokens} tokens were reasoning tokens`);
      }
      
      console.log(`Time: ${processingTime}ms`);
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
      results.push({
        config: config.name,
        success: false,
        error: error.message
      });
    }
    
    // Small delay between tests
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Summary
  console.log('\n' + '=' .repeat(60));
  console.log('📊 RESULTS SUMMARY');
  console.log('=' .repeat(60));
  
  const successfulConfigs = results.filter(r => r.success && r.content !== '(empty)');
  const emptyConfigs = results.filter(r => r.success && r.content === '(empty)');
  const errorConfigs = results.filter(r => r.error);
  
  console.log(`\n✅ Successful (with content): ${successfulConfigs.length}/${results.length}`);
  successfulConfigs.forEach(r => {
    console.log(`  - ${r.config}`);
    console.log(`    Content: "${r.content}"`);
    console.log(`    Visible tokens: ${r.tokens.visible}`);
  });
  
  console.log(`\n⚠️ Empty responses: ${emptyConfigs.length}/${results.length}`);
  emptyConfigs.forEach(r => {
    console.log(`  - ${r.config}`);
    console.log(`    Reasoning tokens: ${r.tokens.reasoning}`);
  });
  
  console.log(`\n❌ Errors: ${errorConfigs.length}/${results.length}`);
  errorConfigs.forEach(r => {
    console.log(`  - ${r.config}: ${r.error}`);
  });
  
  // Test with GPT-4o-mini for comparison
  console.log('\n' + '=' .repeat(60));
  console.log('🔄 COMPARISON WITH GPT-4o-mini');
  console.log('=' .repeat(60));
  
  try {
    const gpt4Response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: testPrompt }],
      max_tokens: 50
    });
    
    console.log('\nGPT-4o-mini response:', gpt4Response.choices[0].message.content);
    console.log('Tokens:', gpt4Response.usage.completion_tokens);
    
  } catch (error) {
    console.log('GPT-4o-mini error:', error.message);
  }
  
  return results;
}

// Run the test
testConfigurations().catch(console.error);