#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';

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

// Process multiple videos in parallel
async function generateBatchSummaries(videos, batchSize = 10) {
  const summaries = [];
  
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    
    const batchPromises = batch.map(video => 
      openai.chat.completions.create({
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
      }).then(response => ({
        id: video.id,
        title: video.title,
        channel: video.channel_name,
        summary: response.choices[0].message.content.trim()
      })).catch(error => {
        console.error(`Error for video ${video.id}:`, error.message);
        return null;
      })
    );
    
    const batchResults = await Promise.all(batchPromises);
    summaries.push(...batchResults.filter(Boolean));
    
    console.log(`  Processed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(videos.length/batchSize)} (${summaries.length} total)`);
    
    if (i + batchSize < videos.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return summaries;
}

async function generateBatchEmbeddings(texts, model = 'text-embedding-3-small') {
  const embeddings = [];
  const batchSize = 100;
  
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    
    try {
      const response = await openai.embeddings.create({
        input: batch,
        model: model
      });
      
      embeddings.push(...response.data.map(item => item.embedding));
      console.log(`    Embeddings batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(texts.length/batchSize)} complete`);
    } catch (error) {
      console.error('Embedding error:', error);
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return embeddings;
}

async function testRealVideos() {
  console.log('🛠️ Testing LLM Summaries on YOUR ACTUAL Videos (Maker/DIY/Tech Content)\n');
  
  const TEST_SIZE = 200;
  
  // Get a diverse sample from your actual database
  // Mix of popular channels to get varied content
  const targetChannels = [
    '3D Printing Nerd',
    'Bourbon Moth Woodworking', 
    'Jay Bates',
    'Matthew Cremona',
    'mpoxDE',
    'Modern Builds',
    'Charles Cornell',
    'DIY Projects',
    'Woodcraft',
    'izzy swan'
  ];
  
  // Get videos from these channels with descriptions
  const { data: allVideos, error } = await supabase
    .from('videos')
    .select('id, title, description, channel_name, view_count')
    .in('channel_name', targetChannels)
    .not('description', 'is', null)
    .limit(500);
  
  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }
  
  // Filter for meaningful descriptions and shuffle
  const videos = allVideos
    .filter(v => v.description && v.description.length >= 200)
    .sort(() => Math.random() - 0.5)
    .slice(0, TEST_SIZE);
  
  console.log(`Found ${videos.length} videos from maker/DIY channels\n`);
  
  // Show channel distribution
  const channelCounts = {};
  videos.forEach(v => {
    channelCounts[v.channel_name] = (channelCounts[v.channel_name] || 0) + 1;
  });
  
  console.log('Channel distribution:');
  Object.entries(channelCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([channel, count]) => {
      console.log(`  ${channel}: ${count} videos`);
    });
  
  // Generate summaries
  console.log('\n\n📝 Generating LLM summaries for maker/DIY content...');
  const startTime = Date.now();
  
  const videoData = await generateBatchSummaries(videos, 10);
  
  const summaryTime = Date.now() - startTime;
  console.log(`\n✅ Generated ${videoData.length} summaries in ${(summaryTime/1000).toFixed(1)}s\n`);
  
  // Show sample summaries from different content types
  console.log('📋 Sample Summaries by Category:\n');
  
  // 3D Printing samples
  console.log('🖨️ 3D PRINTING:');
  const printing = videoData.filter(v => v.channel === '3D Printing Nerd' || v.channel === 'mpoxDE').slice(0, 3);
  printing.forEach(v => {
    console.log(`\n"${v.title.substring(0, 60)}..."`);
    console.log(`Summary: ${v.summary}`);
  });
  
  // Woodworking samples
  console.log('\n\n🪵 WOODWORKING:');
  const woodworking = videoData.filter(v => 
    v.channel.includes('Wood') || v.channel.includes('Jay Bates') || v.channel.includes('Matthew Cremona')
  ).slice(0, 3);
  woodworking.forEach(v => {
    console.log(`\n"${v.title.substring(0, 60)}..."`);
    console.log(`Summary: ${v.summary}`);
  });
  
  // DIY/Maker samples
  console.log('\n\n🔨 DIY/MAKER:');
  const diy = videoData.filter(v => 
    v.channel.includes('DIY') || v.channel.includes('Modern Builds')
  ).slice(0, 3);
  diy.forEach(v => {
    console.log(`\n"${v.title.substring(0, 60)}..."`);
    console.log(`Summary: ${v.summary}`);
  });
  
  // Prepare texts for embeddings
  const titleTexts = videoData.map(v => v.title);
  const combinedTexts = videoData.map(v => `${v.title} | ${v.summary}`);
  
  // Generate embeddings
  console.log('\n\n🔢 Generating embeddings...');
  
  console.log('  Generating title-only embeddings...');
  const titleEmbeddings = await generateBatchEmbeddings(titleTexts);
  
  console.log('\n  Generating title+summary embeddings...');
  const combinedEmbeddings = await generateBatchEmbeddings(combinedTexts);
  
  // Save data for Python BERTopic analysis
  const outputData = {
    videos: videoData,
    embeddings: {
      title_only: titleEmbeddings,
      title_plus_summary: combinedEmbeddings
    }
  };
  
  await fs.writeFile(
    'real_videos_llm_embeddings.json',
    JSON.stringify(outputData, null, 2)
  );
  
  console.log('\n💾 Saved embeddings to real_videos_llm_embeddings.json');
  console.log('   Ready for BERTopic analysis on YOUR actual content');
  
  // Cost calculation
  const avgDescLength = videos.reduce((sum, v) => sum + v.description.substring(0, 1000).length, 0) / videos.length;
  const tokensPerVideo = (SUMMARY_PROMPT.length + avgDescLength + 100) / 4;
  const totalSummaryTokens = videoData.length * tokensPerVideo;
  
  const embeddingChars = titleTexts.join(' ').length + combinedTexts.join(' ').length;
  const embeddingTokens = embeddingChars / 4;
  
  const summaryCost = (totalSummaryTokens / 1000000) * 0.150;
  const embeddingCost = (embeddingTokens / 1000000) * 0.020;
  
  console.log('\n💰 Cost Analysis:');
  console.log(`  Videos processed: ${videoData.length}`);
  console.log(`  Summary generation: $${summaryCost.toFixed(2)}`);
  console.log(`  Embeddings: $${embeddingCost.toFixed(2)}`);
  console.log(`  Total for test: $${(summaryCost + embeddingCost).toFixed(2)}`);
  console.log(`  \nProjected cost for 178K videos: $${((summaryCost + embeddingCost) * 178000 / videoData.length).toFixed(2)}`);
  
  const batchCost = (summaryCost * 0.5);
  console.log(`  \nWith Batch API (24hr): $${(batchCost * 178000 / videoData.length).toFixed(2)} for 178K videos`);
}

testRealVideos().catch(console.error);