/**
 * Check what OpenAI models are actually available
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function checkAvailableModels() {
  console.log('🔍 Checking Available OpenAI Models\n');
  
  try {
    // List all available models
    const models = await openai.models.list();
    
    // Filter and sort models
    const chatModels = [];
    const visionModels = [];
    const embeddingModels = [];
    const otherModels = [];
    
    for (const model of models.data) {
      const id = model.id;
      
      if (id.includes('gpt')) {
        if (id.includes('vision') || id === 'gpt-4o' || id === 'gpt-4o-mini') {
          visionModels.push(id);
        } else {
          chatModels.push(id);
        }
      } else if (id.includes('embedding')) {
        embeddingModels.push(id);
      } else {
        otherModels.push(id);
      }
    }
    
    console.log('📝 CHAT MODELS:');
    chatModels.sort().forEach(m => console.log(`  - ${m}`));
    
    console.log('\n👁️ VISION-CAPABLE MODELS:');
    visionModels.sort().forEach(m => console.log(`  - ${m}`));
    
    console.log('\n🔢 EMBEDDING MODELS:');
    embeddingModels.sort().forEach(m => console.log(`  - ${m}`));
    
    console.log('\n🔧 OTHER MODELS:');
    otherModels.sort().forEach(m => console.log(`  - ${m}`));
    
    // Check for GPT-5 models specifically
    console.log('\n🔎 GPT-5 MODEL CHECK:');
    const gpt5Models = models.data.filter(m => m.id.includes('gpt-5'));
    if (gpt5Models.length > 0) {
      console.log('✅ GPT-5 models found:');
      gpt5Models.forEach(m => console.log(`  - ${m.id}`));
    } else {
      console.log('❌ No GPT-5 models available yet');
    }
    
    // Check for reasoning models (o1, o3)
    console.log('\n🧠 REASONING MODELS:');
    const reasoningModels = models.data.filter(m => 
      m.id.includes('o1') || m.id.includes('o3') || m.id.includes('reasoning')
    );
    if (reasoningModels.length > 0) {
      reasoningModels.forEach(m => console.log(`  - ${m.id}`));
    } else {
      console.log('  None found');
    }
    
    // Test a simple call with the latest available model
    console.log('\n🧪 Testing latest GPT-4o model...');
    const testResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'What model are you?' }],
      max_tokens: 50
    });
    
    console.log(`Response: ${testResponse.choices[0].message.content}`);
    console.log(`Model used: ${testResponse.model}`);
    
  } catch (error) {
    console.error('Error checking models:', error.message);
  }
}

checkAvailableModels();