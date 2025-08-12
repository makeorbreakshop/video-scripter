/**
 * Direct test of GPT-5 Responses API
 * Tests if GPT-5 models are actually available and working
 */

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function testGPT5Direct() {
  console.log('🧪 Testing GPT-5 Direct API Access...\n');
  
  const models = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'];
  
  for (const model of models) {
    console.log(`\n=== Testing ${model} ===`);
    
    try {
      // Test 1: Check if model exists via chat.completions (should fail for GPT-5)
      console.log('📞 Testing chat.completions API...');
      try {
        const chatResponse = await client.chat.completions.create({
          model,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10
        });
        console.log('✅ chat.completions works:', chatResponse.choices[0].message.content);
      } catch (error) {
        console.log('❌ chat.completions failed:', error.error?.code || error.message);
        
        // Test 2: Try responses API with minimal parameters
        console.log('📞 Testing responses API...');
        try {
          const responsesResponse = await client.responses.create({
            model,
            input: 'Hello'
          });
          console.log('✅ responses API works!');
          console.log('   Response structure:', Object.keys(responsesResponse));
          console.log('   Response content:', JSON.stringify(responsesResponse, null, 2).substring(0, 500) + '...');
        } catch (responseError) {
          console.log('❌ responses API failed:', responseError.error?.code || responseError.message);
          
          // Test 3: Try with instructions parameter instead
          console.log('📞 Testing responses API with instructions...');
          try {
            const instructionsResponse = await client.responses.create({
              model,
              instructions: 'You are a helpful assistant.',
              input: 'Hello'
            });
            console.log('✅ responses API with instructions works!');
            console.log('   Response structure:', Object.keys(instructionsResponse));
            console.log('   Response content:', JSON.stringify(instructionsResponse, null, 2).substring(0, 500) + '...');
          } catch (instructionsError) {
            console.log('❌ responses API with instructions failed:', instructionsError.error?.code || instructionsError.message);
          }
        }
      }
      
    } catch (error) {
      console.log('❌ Model test failed:', error.error?.code || error.message);
    }
  }
  
  // Test 3: List available models to see what we have access to
  console.log('\n=== Available Models ===');
  try {
    const modelsList = await client.models.list();
    const gptModels = modelsList.data
      .filter(m => m.id.includes('gpt'))
      .map(m => m.id)
      .sort();
    
    console.log('Available GPT models:');
    gptModels.forEach(model => {
      if (model.includes('5')) {
        console.log(`✨ ${model} (GPT-5 family)`);
      } else {
        console.log(`   ${model}`);
      }
    });
  } catch (error) {
    console.log('❌ Failed to list models:', error.message);
  }
}

// Run the test
testGPT5Direct().catch(console.error);