#!/usr/bin/env node

/**
 * Test basic pattern analysis functionality
 * Check if Claude Sonnet 4 works without extended thinking
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function testBasicPattern() {
  console.log('🔬 Testing Basic Claude Sonnet 4 Integration');
  console.log('============================================\n');

  try {
    // Test 1: Check if video exists
    console.log('1. Checking video data...');
    const { data: video, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', 'XKrDUnZCmQQ')
      .single();

    if (error || !video) {
      throw new Error(`Video not found: ${error?.message}`);
    }
    
    console.log(`✅ Video found: "${video.title}" (${video.temporal_performance_score?.toFixed(1)}x TPS)\n`);

    // Test 2: Check Claude Sonnet 4 basic call
    console.log('2. Testing Claude Sonnet 4 basic call...');
    const testResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 100,
      temperature: 0.7,
      messages: [{
        role: 'user',
        content: 'Say "Claude Sonnet 4 is working" if you can respond.'
      }]
    });

    const responseText = testResponse.content[0]?.type === 'text' ? testResponse.content[0].text : 'No text response';
    console.log(`✅ Claude Sonnet 4 response: "${responseText}"`);
    console.log(`✅ Tokens: ${testResponse.usage.input_tokens} input, ${testResponse.usage.output_tokens} output\n`);

    // Test 3: Check extended thinking capability
    console.log('3. Testing extended thinking capability...');
    try {
      const thinkingResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        temperature: 1,
        thinking: {
          type: "enabled",
          budget_tokens: 1024 // Minimum required
        },
        messages: [{
          role: 'user',
          content: 'Think about why 2+2=4, then explain it simply.'
        }]
      });

      const thinkingText = thinkingResponse.content.find(block => block.type === 'text')?.text || 'No text';
      const thinkingBlock = thinkingResponse.content.find(block => block.type === 'thinking');
      
      console.log(`✅ Extended thinking response: "${thinkingText.substring(0, 100)}..."`);
      console.log(`✅ Thinking tokens: ${thinkingResponse.usage.thinking_tokens || 0}`);
      console.log(`✅ Thinking content available: ${!!thinkingBlock}\n`);

      // Test 4: Check image analysis
      console.log('4. Testing image analysis with Claude Sonnet 4...');
      const imageResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'url', url: video.thumbnail_url }
            },
            {
              type: 'text',
              text: 'Describe this thumbnail in one sentence.'
            }
          ]
        }]
      });

      const imageText = imageResponse.content[0]?.type === 'text' ? imageResponse.content[0].text : 'No text response';
      console.log(`✅ Image analysis: "${imageText}"`);
      console.log(`✅ Vision tokens: ${imageResponse.usage.input_tokens} input, ${imageResponse.usage.output_tokens} output\n`);

      console.log('🎉 ALL TESTS PASSED - Claude Sonnet 4 with extended thinking is working!');
      console.log('📝 Ready to implement in production pattern analysis');

    } catch (thinkingError) {
      console.log(`❌ Extended thinking test failed: ${thinkingError.message}`);
      console.log('🔧 May need to check extended thinking implementation');
    }

  } catch (error) {
    console.error('❌ Basic test failed:', error);
    process.exit(1);
  }
}

testBasicPattern();