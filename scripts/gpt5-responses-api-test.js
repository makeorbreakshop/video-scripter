/**
 * GPT-5 Responses API Test
 * Testing the NEW Responses API vs Chat Completions API
 * Key differences:
 * - Stateful conversation management via previous_response_id
 * - No need to resend full message history
 * - Different endpoint and method structure
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testResponsesAPI() {
  console.log('🚀 GPT-5 RESPONSES API vs CHAT COMPLETIONS COMPARISON');
  console.log('='.repeat(60));
  console.log('Testing the new Responses API with conversation chaining');
  console.log('');

  // ====================
  // CHAT COMPLETIONS API (OLD WAY)
  // ====================
  console.log('1️⃣ CHAT COMPLETIONS API (Traditional Approach)');
  console.log('-'.repeat(60));
  
  try {
    // First turn - must send full context
    const chatResponse1 = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [
        { role: 'user', content: 'My YouTube channel is about cooking. Give me 3 video ideas.' }
      ],
      max_completion_tokens: 2000,
      reasoning_effort: 'minimal'
    });
    
    const content1 = chatResponse1.choices[0].message.content;
    console.log('Turn 1 Response:', content1?.substring(0, 150) + '...');
    console.log('Tokens used:', chatResponse1.usage.completion_tokens);
    
    // Second turn - must resend ALL previous messages
    console.log('\nTurn 2 - Must resend entire conversation history:');
    const chatResponse2 = await openai.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [
        { role: 'user', content: 'My YouTube channel is about cooking. Give me 3 video ideas.' },
        { role: 'assistant', content: content1 },  // Must include previous response
        { role: 'user', content: 'Now give me catchy titles for the first idea.' }
      ],
      max_completion_tokens: 2000,
      reasoning_effort: 'minimal'
    });
    
    console.log('Turn 2 Response:', chatResponse2.choices[0].message.content?.substring(0, 150) + '...');
    console.log('Tokens sent (includes history):', chatResponse2.usage.prompt_tokens);
    console.log('❌ Problem: Had to resend', chatResponse2.usage.prompt_tokens, 'tokens of context!');
    
  } catch (error) {
    console.log('Chat Completions Error:', error.message);
  }
  
  await new Promise(r => setTimeout(r, 2000));
  
  // ====================
  // RESPONSES API (NEW WAY)
  // ====================
  console.log('\n' + '='.repeat(60));
  console.log('2️⃣ RESPONSES API (New Stateful Approach)');
  console.log('-'.repeat(60));
  
  try {
    // First turn - store the conversation
    console.log('Turn 1 - Initial request with store=true:');
    const response1 = await openai.responses.create({
      model: 'gpt-5-nano',
      input: 'My YouTube channel is about cooking. Give me 3 video ideas.',
      store: true,  // IMPORTANT: Store conversation state on server
      max_completion_tokens: 2000,
      reasoning_effort: 'minimal'
    });
    
    console.log('Response ID:', response1.id);
    console.log('Turn 1 Response:', response1.output[0].content[0].text?.substring(0, 150) + '...');
    console.log('Tokens used:', response1.usage.completion_tokens);
    
    // Second turn - just reference the previous response!
    console.log('\nTurn 2 - Using previous_response_id (no history resent!):');
    const response2 = await openai.responses.create({
      model: 'gpt-5-nano',
      input: 'Now give me catchy titles for the first idea.',
      previous_response_id: response1.id,  // Magic! References stored conversation
      store: true,
      max_completion_tokens: 2000,
      reasoning_effort: 'minimal'
    });
    
    console.log('Response ID:', response2.id);
    console.log('Turn 2 Response:', response2.output[0].content[0].text?.substring(0, 150) + '...');
    console.log('Tokens sent (just new input):', response2.usage.prompt_tokens);
    console.log('✅ Benefit: Only sent new input, not entire history!');
    
    // Third turn - continue the chain
    console.log('\nTurn 3 - Continuing the conversation chain:');
    const response3 = await openai.responses.create({
      model: 'gpt-5-nano',
      input: 'What equipment would I need for the first video?',
      previous_response_id: response2.id,  // Chain from response2
      store: true,
      max_completion_tokens: 2000,
      reasoning_effort: 'minimal'
    });
    
    console.log('Turn 3 Response:', response3.output[0].content[0].text?.substring(0, 150) + '...');
    console.log('Conversation maintained without resending history!');
    
    // Can also retrieve a previous response
    console.log('\n📥 Retrieving a previous response:');
    const fetched = await openai.responses.retrieve(response1.id);
    console.log('Retrieved response ID:', fetched.id);
    console.log('Original output still accessible');
    
  } catch (error) {
    console.log('Responses API Error:', error.message);
    console.log('Note: Responses API may not be available yet for all accounts');
  }
  
  // ====================
  // SUMMARY
  // ====================
  console.log('\n' + '='.repeat(60));
  console.log('💡 KEY DIFFERENCES SUMMARY');
  console.log('='.repeat(60));
  
  console.log(`
CHAT COMPLETIONS API (Old):
- Endpoint: /v1/chat/completions
- Stateless - must resend full conversation
- Token usage grows with each turn
- messages: [{role, content}] format
- Manual conversation management

RESPONSES API (New):
- Endpoint: /v1/responses
- Stateful with previous_response_id
- Only send new input each turn
- input: string or multimodal format
- Server-side conversation storage
- Built-in tool support
- store: true for persistence

BENEFITS OF RESPONSES API:
1. Reduced token usage (no history resending)
2. Simplified conversation management
3. Better for multi-turn interactions
4. Native tool integration
5. Reasoning token persistence for GPT-5
`);

  console.log('📝 MIGRATION STRATEGY:');
  console.log('1. Use Responses API for new multi-turn features');
  console.log('2. Keep Chat Completions for single-turn requests');
  console.log('3. Responses API ideal for conversational UI');
  console.log('4. Consider storing response_ids for session continuity');
}

// Run the test
testResponsesAPI().catch(console.error);