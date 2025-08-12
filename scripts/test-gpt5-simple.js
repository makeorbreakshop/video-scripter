#!/usr/bin/env node

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testGPT5() {
  console.log('Testing GPT-5 models with NO parameters (as documented)...\n');
  
  const models = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'];
  
  for (const model of models) {
    try {
      console.log(`Testing ${model}...`);
      
      const completion = await openai.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Say "hello" in one word.' }
        ]
        // NO temperature, NO max_tokens, NO max_completion_tokens
      });
      
      console.log(`✅ ${model} works! Response: ${completion.choices[0].message.content}`);
      console.log(`   Tokens used: ${completion.usage?.total_tokens || 'unknown'}\n`);
      
    } catch (error) {
      console.log(`❌ ${model} failed: ${error.message}\n`);
    }
  }
}

testGPT5().catch(console.error);