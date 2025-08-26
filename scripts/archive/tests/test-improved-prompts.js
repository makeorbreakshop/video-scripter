#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Original prompt
const ORIGINAL_PROMPT = `Extract ONLY the actual video content from this YouTube description. 

Ignore ALL of these:
- Affiliate links, product links, gear lists
- Sponsorship messages and discount codes  
- Social media links (Instagram, Twitter, etc)
- Channel promotions and "subscribe" messages
- Timestamps/chapters
- Credits, music attributions
- Patreon/membership calls

Output a 1-2 sentence summary of what the video actually teaches, shows, or discusses. Focus on the core content only.`;

// Improved prompts to test
const IMPROVED_PROMPTS = [
  {
    name: "Direct Content",
    prompt: `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write a 1-2 sentence description of the actual content WITHOUT using phrases like "the video", "this video", "it shows", or "it demonstrates".

Start directly with what is being done or taught. For example:
- Instead of "The video shows how to build a table" → "Building a custom dining table using reclaimed wood"
- Instead of "This video demonstrates 3D printing" → "3D printing a functional gear system with PLA filament"
- Instead of "The video discusses chess tactics" → "Advanced chess tactics for controlling the center board"

Focus only on the core content.`
  },
  {
    name: "Action-First",
    prompt: `Analyze this YouTube description and extract only the core content, ignoring all promotional material.

Describe what happens or what is taught in 1-2 sentences. Start with an action verb or noun phrase. Never mention "video", "tutorial", or similar meta-references.

Examples of good starts:
- "Creating a..." 
- "Building a..."
- "Advanced techniques for..."
- "How to..."
- "Step-by-step guide to..."
- "Comparison of..."

Focus purely on the content itself.`
  },
  {
    name: "Topic-Focused", 
    prompt: `From this YouTube description, identify and describe the main topic or activity in 1-2 sentences.

Rules:
- DO NOT use words like: video, shows, demonstrates, discusses, features, showcases, presents
- DO NOT reference the medium (video/tutorial/guide)
- DO start with the topic, technique, or project itself
- DO include specific details like materials, tools, or methods when relevant

Ignore all sponsorships, links, and promotional content. Focus only on what is actually being done or taught.`
  }
];

async function testPrompt(video, promptConfig) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: promptConfig.prompt
        },
        {
          role: 'user',
          content: `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description?.substring(0, 1000) || 'No description'}`
        }
      ],
      temperature: 0.3,
      max_tokens: 100
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return null;
  }
}

async function testImprovedPrompts() {
  console.log('🧪 Testing Improved Summary Prompts\n');
  
  // Get diverse test videos
  const { data: videos } = await supabase
    .from('videos')
    .select('id, title, description, channel_name')
    .not('description', 'is', null)
    .in('channel_name', [
      '731 Woodworks',
      '3D Printing Nerd', 
      'GothamChess',
      'Amy Darley',
      'DIY Woodworking Projects',
      'Alec Steele'
    ])
    .limit(12);
  
  if (!videos || videos.length === 0) {
    console.error('No videos found');
    return;
  }
  
  // Test each video with each prompt
  for (const video of videos.slice(0, 6)) {
    console.log('='.repeat(80));
    console.log(`\n📹 TITLE: "${video.title}"`);
    console.log(`📺 CHANNEL: ${video.channel_name}`);
    console.log(`📄 Description preview: ${video.description.substring(0, 150)}...\n`);
    
    // Test original prompt
    const originalSummary = await testPrompt(video, { prompt: ORIGINAL_PROMPT });
    console.log(`❌ ORIGINAL PROMPT:`);
    console.log(`   "${originalSummary}"\n`);
    
    // Test improved prompts
    for (const promptConfig of IMPROVED_PROMPTS) {
      const improvedSummary = await testPrompt(video, promptConfig);
      console.log(`✅ ${promptConfig.name.toUpperCase()} PROMPT:`);
      console.log(`   "${improvedSummary}"`);
      
      // Check if it still contains problematic patterns
      const hasVideoMention = improvedSummary.toLowerCase().includes('video') || 
                             improvedSummary.toLowerCase().includes('tutorial');
      const startsWithThe = improvedSummary.toLowerCase().startsWith('the ');
      
      if (hasVideoMention || startsWithThe) {
        console.log(`   ⚠️  Still contains: ${hasVideoMention ? '"video" mention' : ''} ${startsWithThe ? 'starts with "The"' : ''}`);
      } else {
        console.log(`   ✓  Clean summary!`);
      }
      console.log();
    }
  }
  
  // Test on a batch to see consistency
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 BATCH TEST - Using TOPIC-FOCUSED prompt on 10 videos:\n');
  
  const batchResults = [];
  for (const video of videos.slice(0, 10)) {
    const summary = await testPrompt(video, IMPROVED_PROMPTS[2]); // Topic-Focused
    batchResults.push({
      title: video.title,
      summary: summary
    });
  }
  
  batchResults.forEach((result, i) => {
    console.log(`${i+1}. "${result.title.substring(0, 60)}..."`);
    console.log(`   → ${result.summary}`);
    console.log();
  });
  
  // Analyze patterns in batch
  const videoMentions = batchResults.filter(r => 
    r.summary.toLowerCase().includes('video') || 
    r.summary.toLowerCase().includes('tutorial')
  ).length;
  
  const startsWithThe = batchResults.filter(r => 
    r.summary.toLowerCase().startsWith('the ')
  ).length;
  
  console.log('📈 BATCH STATISTICS:');
  console.log(`- Videos mentioning "video/tutorial": ${videoMentions}/${batchResults.length} (${(videoMentions/batchResults.length*100).toFixed(0)}%)`);
  console.log(`- Starting with "The": ${startsWithThe}/${batchResults.length} (${(startsWithThe/batchResults.length*100).toFixed(0)}%)`);
}

testImprovedPrompts().catch(console.error);