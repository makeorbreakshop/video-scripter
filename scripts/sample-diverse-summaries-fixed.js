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

async function generateSummary(video) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: SUMMARY_PROMPT
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
    console.error(`Error for video ${video.id}:`, error.message);
    return null;
  }
}

async function sampleDiverseSummaries() {
  console.log('🎬 Sampling Diverse Videos from Your Database\n');
  
  // Get a large random sample first
  const { data: allVideos, error } = await supabase
    .from('videos')
    .select('id, title, description, channel_name, view_count')
    .not('description', 'is', null)
    .limit(2000);
  
  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }
  
  // Filter for meaningful descriptions and group by channel
  const videosByChannel = {};
  allVideos
    .filter(v => v.description && v.description.length >= 200)
    .forEach(video => {
      if (!videosByChannel[video.channel_name]) {
        videosByChannel[video.channel_name] = [];
      }
      videosByChannel[video.channel_name].push(video);
    });
  
  // Get channels with at least 2 videos
  const channels = Object.keys(videosByChannel)
    .filter(ch => videosByChannel[ch].length >= 2)
    .sort(() => Math.random() - 0.5)
    .slice(0, 50);
  
  console.log(`Found ${Object.keys(videosByChannel).length} channels with content`);
  console.log(`Sampling from ${channels.length} diverse channels...\n`);
  
  // Take 4 videos from each channel (or less if not available)
  const selectedVideos = [];
  channels.forEach(channel => {
    const channelVideos = videosByChannel[channel]
      .sort(() => Math.random() - 0.5)
      .slice(0, 4);
    selectedVideos.push(...channelVideos);
  });
  
  // Take first 200 videos
  const finalSample = selectedVideos.slice(0, 200);
  
  console.log(`Processing ${finalSample.length} videos from ${new Set(finalSample.map(v => v.channel_name)).size} different channels\n`);
  console.log('='*80 + '\n');
  
  // Process and show results
  const results = [];
  let currentChannel = '';
  
  // Sort by channel for better display
  finalSample.sort((a, b) => a.channel_name.localeCompare(b.channel_name));
  
  for (let i = 0; i < finalSample.length; i++) {
    const video = finalSample[i];
    
    // Show channel header when it changes
    if (video.channel_name !== currentChannel) {
      currentChannel = video.channel_name;
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📺 CHANNEL: ${currentChannel}`);
      console.log(`${'='.repeat(80)}\n`);
    }
    
    // Generate summary
    const summary = await generateSummary(video);
    
    if (summary) {
      results.push({
        channel: video.channel_name,
        title: video.title,
        summary: summary,
        description_preview: video.description.substring(0, 150)
      });
      
      console.log(`📹 Title: "${video.title}"`);
      console.log(`📝 Summary: ${summary}`);
      console.log();
    }
    
    // Rate limiting
    if (i % 10 === 0 && i > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Show summary stats
  console.log('\n\n' + '='*80);
  console.log('📊 SUMMARY OF WHAT LLM EXTRACTED:\n');
  
  // Analyze common themes in summaries
  const commonWords = {};
  results.forEach(r => {
    const words = r.summary.toLowerCase().split(/\s+/);
    words.forEach(word => {
      if (word.length > 4 && !['video', 'shows', 'demonstrates', 'features', 'discusses'].includes(word)) {
        commonWords[word] = (commonWords[word] || 0) + 1;
      }
    });
  });
  
  console.log('Most common content themes:');
  Object.entries(commonWords)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([word, count]) => {
      if (count > 3) {
        console.log(`  ${word}: ${count} occurrences`);
      }
    });
  
  console.log(`\nTotal: ${results.length} summaries generated`);
}

sampleDiverseSummaries().catch(console.error);