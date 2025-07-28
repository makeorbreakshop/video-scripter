#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SUMMARY_PROMPT = `Extract ONLY the actual video content from this YouTube description. 

Ignore ALL of these:
- Affiliate links, product links, gear lists
- Sponsorship messages and discount codes  
- Social media links (Instagram, Twitter, etc)
- Channel promotions and "subscribe" messages
- Timestamps/chapters
- Credits, music attributions
- Patreon/membership calls

Output a 1-2 sentence summary of what the video actually teaches, shows, or discusses. Focus on the core content only.`;

async function getOpenAISummary(video, model = 'gpt-4o-mini') {
  try {
    const start = Date.now();
    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: SUMMARY_PROMPT
        },
        {
          role: 'user',
          content: `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description?.substring(0, 2000) || 'No description'}`
        }
      ],
      temperature: 0.3,
      max_tokens: 100
    });
    
    const time = Date.now() - start;
    const summary = response.choices[0].message.content.trim();
    const tokens = response.usage;
    
    return {
      summary,
      time,
      tokens_in: tokens.prompt_tokens,
      tokens_out: tokens.completion_tokens,
      model
    };
  } catch (error) {
    console.error(`Error with ${model}:`, error.message);
    return null;
  }
}

async function getClaudeSummary(video, model = 'claude-3-haiku-20240307') {
  try {
    const start = Date.now();
    const response = await anthropic.messages.create({
      model: model,
      max_tokens: 100,
      temperature: 0.3,
      system: SUMMARY_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description?.substring(0, 2000) || 'No description'}`
        }
      ]
    });
    
    const time = Date.now() - start;
    const summary = response.content[0].text.trim();
    
    return {
      summary,
      time,
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      model
    };
  } catch (error) {
    console.error(`Error with ${model}:`, error.message);
    return null;
  }
}

async function compareLLMSummaries() {
  console.log('🤖 Comparing LLM Description Summaries\n');
  
  // Get diverse video samples with long descriptions
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, description, channel_name, view_count')
    .not('description', 'is', null)
    .order('view_count', { ascending: false })
    .limit(50);  // Get more to filter
  
  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }
  
  // Filter for videos with substantial descriptions
  const filteredVideos = videos.filter(v => v.description && v.description.length >= 500).slice(0, 10);
  
  console.log(`Testing on ${filteredVideos.length} videos with substantial descriptions\n`);
  console.log('='.repeat(60) + '\n');
  
  const results = [];
  
  for (let i = 0; i < filteredVideos.length; i++) {
    const video = filteredVideos[i];
    console.log(`\n📹 Video ${i + 1}: ${video.title.substring(0, 60)}...`);
    console.log(`Channel: ${video.channel_name}`);
    console.log(`Description length: ${video.description.length} chars`);
    console.log('\nSample of description:');
    console.log(video.description.substring(0, 200) + '...\n');
    
    const videoResults = {
      video_id: video.id,
      title: video.title,
      description_preview: video.description.substring(0, 200),
      summaries: {}
    };
    
    // Test GPT-4o-mini
    console.log('Testing GPT-4o-mini...');
    const gpt4oMini = await getOpenAISummary(video, 'gpt-4o-mini');
    if (gpt4oMini) {
      console.log(`✓ Summary: ${gpt4oMini.summary}`);
      console.log(`  Time: ${gpt4oMini.time}ms | Tokens: ${gpt4oMini.tokens_in}/${gpt4oMini.tokens_out}`);
      videoResults.summaries['gpt-4o-mini'] = gpt4oMini;
    }
    
    // Test GPT-3.5-turbo
    console.log('\nTesting GPT-3.5-turbo...');
    const gpt35 = await getOpenAISummary(video, 'gpt-3.5-turbo');
    if (gpt35) {
      console.log(`✓ Summary: ${gpt35.summary}`);
      console.log(`  Time: ${gpt35.time}ms | Tokens: ${gpt35.tokens_in}/${gpt35.tokens_out}`);
      videoResults.summaries['gpt-3.5-turbo'] = gpt35;
    }
    
    // Test Claude Haiku
    console.log('\nTesting Claude Haiku...');
    const claude = await getClaudeSummary(video, 'claude-3-haiku-20240307');
    if (claude) {
      console.log(`✓ Summary: ${claude.summary}`);
      console.log(`  Time: ${claude.time}ms | Tokens: ${claude.tokens_in}/${claude.tokens_out}`);
      videoResults.summaries['claude-haiku'] = claude;
    }
    
    results.push(videoResults);
    console.log('\n' + '-'*60);
  }
  
  // Calculate costs and stats
  console.log('\n\n📊 COST ANALYSIS FOR 170,000 VIDEOS:\n');
  
  const models = {
    'gpt-4o-mini': { 
      input: 0.150 / 1000000, 
      output: 0.600 / 1000000,
      name: 'GPT-4o-mini'
    },
    'gpt-3.5-turbo': { 
      input: 0.500 / 1000000, 
      output: 1.500 / 1000000,
      name: 'GPT-3.5-turbo'
    },
    'claude-haiku': { 
      input: 0.250 / 1000000, 
      output: 1.250 / 1000000,
      name: 'Claude Haiku'
    }
  };
  
  for (const [modelKey, pricing] of Object.entries(models)) {
    const modelResults = results
      .map(r => r.summaries[modelKey])
      .filter(Boolean);
    
    if (modelResults.length > 0) {
      const avgTokensIn = modelResults.reduce((sum, r) => sum + r.tokens_in, 0) / modelResults.length;
      const avgTokensOut = modelResults.reduce((sum, r) => sum + r.tokens_out, 0) / modelResults.length;
      const avgTime = modelResults.reduce((sum, r) => sum + r.time, 0) / modelResults.length;
      
      const totalTokensIn = avgTokensIn * 170000;
      const totalTokensOut = avgTokensOut * 170000;
      const totalCost = (totalTokensIn * pricing.input) + (totalTokensOut * pricing.output);
      
      console.log(`\n${pricing.name}:`);
      console.log(`  Avg tokens: ${Math.round(avgTokensIn)} in / ${Math.round(avgTokensOut)} out`);
      console.log(`  Avg time: ${Math.round(avgTime)}ms per video`);
      console.log(`  Total cost for 170K videos: $${totalCost.toFixed(2)}`);
      console.log(`  Processing time: ~${(170000 * avgTime / 1000 / 3600).toFixed(1)} hours`);
    }
  }
  
  // Quality comparison
  console.log('\n\n🎯 QUALITY COMPARISON:\n');
  
  for (let i = 0; i < Math.min(3, results.length); i++) {
    const result = results[i];
    console.log(`\nVideo: "${result.title.substring(0, 50)}..."`);
    console.log('Summaries:');
    
    for (const [model, data] of Object.entries(result.summaries)) {
      if (data) {
        console.log(`  ${model}: ${data.summary}`);
      }
    }
  }
  
  // Save full results
  const fs = await import('fs/promises');
  await fs.writeFile(
    'llm_summary_comparison.json',
    JSON.stringify(results, null, 2)
  );
  
  console.log('\n\n💾 Full results saved to llm_summary_comparison.json');
}

compareLLMSummaries().catch(console.error);