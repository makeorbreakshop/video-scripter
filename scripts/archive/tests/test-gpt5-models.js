#!/usr/bin/env node

import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testGPT5Models() {
  console.log('Testing GPT-5 model availability...\n');
  
  // Test different possible GPT-5 model names
  const modelsToTest = [
    'gpt-5',
    'gpt-5-preview',
    'gpt-5-turbo',
    'gpt-5-mini',
    'gpt-5-nano',
    'gpt-5-2024-12-17',  // Common date format
    'gpt-5-2025-01-14',  // Release date format
  ];
  
  for (const modelName of modelsToTest) {
    try {
      console.log(`Testing model: ${modelName}`);
      
      const response = await openai.chat.completions.create({
        model: modelName,
        messages: [
          { role: 'user', content: 'Say "Hello, I am ' + modelName + '"' }
        ],
        // GPT-5 models use max_completion_tokens instead of max_tokens
        ...(modelName.startsWith('gpt-5') 
          ? { max_completion_tokens: 20 } 
          : { max_tokens: 20 })
      });
      
      console.log(`✅ SUCCESS: ${modelName}`);
      console.log(`Response: ${response.choices[0].message.content}`);
      console.log(`Actual model used: ${response.model}\n`);
      
    } catch (error) {
      console.log(`❌ FAILED: ${modelName}`);
      console.log(`Error: ${error.message}\n`);
    }
  }
  
  // Also list all available models
  try {
    console.log('Available models from OpenAI API:');
    const models = await openai.models.list();
    const gptModels = models.data
      .filter(model => model.id.includes('gpt'))
      .sort((a, b) => a.id.localeCompare(b.id));
    
    gptModels.forEach(model => {
      console.log(`- ${model.id}`);
    });
    
  } catch (error) {
    console.log('Error listing models:', error.message);
  }
}

testGPT5Models().catch(console.error);