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
  
  // First, get channel distribution
  const { data: channelStats, error: statsError } = await supabase
    .from('videos')
    .select('channel_name')
    .not('description', 'is', null);
  
  if (statsError) {
    console.error('Error getting channel stats:', statsError);
    return;
  }
  
  // Count videos per channel
  const channelCounts = {};
  channelStats.forEach(v => {
    channelCounts[v.channel_name] = (channelCounts[v.channel_name] || 0) + 1;
  });
  
  // Get top channels by video count
  const topChannels = Object.entries(channelCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([channel]) => channel);
  
  console.log(`Found ${Object.keys(channelCounts).length} channels total`);
  console.log(`Sampling from top 50 channels...\n`);
  
  // Get videos from diverse channels
  const videosPerChannel = 4; // Get 4 videos from each channel
  const allVideos = [];
  
  for (const channel of topChannels) {
    const { data: videos } = await supabase
      .from('videos')
      .select('id, title, description, channel_name, view_count')
      .eq('channel_name', channel)
      .not('description', 'is', null)
      .gte('length(description)', 200)
      .limit(videosPerChannel);
    
    if (videos && videos.length > 0) {
      allVideos.push(...videos);
    }
  }
  
  // Shuffle and take 200
  const shuffled = allVideos.sort(() => Math.random() - 0.5).slice(0, 200);
  
  console.log(`Processing ${shuffled.length} videos from ${new Set(shuffled.map(v => v.channel_name)).size} different channels\n`);
  console.log('='*80 + '\n');
  
  // Process in batches and show results
  const results = [];
  let currentChannel = '';
  
  for (let i = 0; i < shuffled.length; i++) {
    const video = shuffled[i];
    
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
      console.log(`📄 Description preview: ${video.description.substring(0, 120)}...`);
      console.log();
    }
    
    // Rate limiting
    if (i % 10 === 0 && i > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Show channel distribution
  console.log('\n\n' + '='*80);
  console.log('📊 CHANNEL DISTRIBUTION IN SAMPLE:\n');
  
  const channelSummary = {};
  results.forEach(r => {
    channelSummary[r.channel] = (channelSummary[r.channel] || 0) + 1;
  });
  
  Object.entries(channelSummary)
    .sort((a, b) => b[1] - a[1])
    .forEach(([channel, count]) => {
      console.log(`  ${channel}: ${count} videos`);
    });
  
  console.log(`\nTotal: ${results.length} videos from ${Object.keys(channelSummary).length} channels`);
}

sampleDiverseSummaries().catch(console.error);