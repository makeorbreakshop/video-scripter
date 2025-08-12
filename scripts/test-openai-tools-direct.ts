#!/usr/bin/env npx tsx
/**
 * Direct test of OpenAI function calling
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function testOpenAITools() {
  console.log('\n🧪 DIRECT OPENAI FUNCTION CALLING TEST\n');
  
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!
  });
  
  // Define a simple tool
  const tools: OpenAI.Chat.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'search_videos',
        description: 'Search for videos by query',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query'
            },
            limit: {
              type: 'number',
              description: 'Number of results'
            }
          },
          required: ['query']
        }
      }
    }
  ];
  
  try {
    console.log('Calling OpenAI with tools...\n');
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a search assistant. Use the search_videos tool to find videos.'
        },
        {
          role: 'user',
          content: 'Search for videos about "satisfying mechanical keyboards". Use the search_videos tool.'
        }
      ],
      tools: tools,
      tool_choice: 'required'  // Force tool use
    });
    
    const message = completion.choices[0].message;
    
    console.log('Response:');
    console.log('- Content:', message.content || '(none)');
    console.log('- Tool calls:', message.tool_calls?.length || 0);
    
    if (message.tool_calls && message.tool_calls.length > 0) {
      console.log('\n✅ TOOL CALLS MADE:');
      message.tool_calls.forEach((call, i) => {
        console.log(`${i + 1}. Function: ${call.function.name}`);
        console.log(`   Arguments: ${call.function.arguments}`);
      });
    } else {
      console.log('\n❌ NO TOOL CALLS MADE');
    }
    
  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

testOpenAITools();