#!/usr/bin/env node
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testOpenAI() {
  console.log('🧪 Testing OpenAI API...');
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{
        role: "system",
        content: "You are a helpful assistant. Respond with JSON."
      }, {
        role: "user",
        content: "Return a simple JSON object with a 'test' key and 'success' value."
      }],
      temperature: 0.3,
      max_tokens: 100
    });

    console.log('✅ OpenAI API working!');
    console.log('Response:', response.choices[0].message.content);
    
  } catch (error) {
    console.error('❌ OpenAI API error:', error.message);
  }
}

testOpenAI();