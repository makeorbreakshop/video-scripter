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

// Process multiple videos in parallel using Promise.all
async function generateBatchSummaries(videos, batchSize = 10) {
  const summaries = [];
  
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    
    // Create promises for all videos in batch
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
    
    // Wait for all in batch to complete
    const batchResults = await Promise.all(batchPromises);
    summaries.push(...batchResults.filter(Boolean));
    
    console.log(`  Processed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(videos.length/batchSize)} (${summaries.length} total)`);
    
    // Rate limiting between batches
    if (i + batchSize < videos.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return summaries;
}

// OpenAI embeddings already support batch processing
async function generateBatchEmbeddings(texts, model = 'text-embedding-3-small') {
  const embeddings = [];
  const batchSize = 100; // OpenAI allows up to 2048 inputs per request
  
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
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return embeddings;
}

async function testLLMSummariesWithBERTopic() {
  console.log('🧠 Testing LLM Summaries with BERTopic (Batch Processing)\n');
  
  // For testing, let's use 200 videos to get meaningful results faster
  const TEST_SIZE = 200;
  
  // Get videos with substantial descriptions FROM YOUR ACTUAL DATA
  const { data: allVideos, error } = await supabase
    .from('videos')
    .select('id, title, description, channel_name, view_count')
    .not('description', 'is', null)
    .order('published_at', { ascending: false }) // Recent videos, not by views
    .limit(500);
  
  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }
  
  // Filter for videos with meaningful descriptions
  const videos = allVideos
    .filter(v => v.description && v.description.length >= 300)
    .slice(0, TEST_SIZE);
  
  console.log(`Found ${videos.length} videos with substantial descriptions\n`);
  
  // Generate summaries using batch processing
  console.log('📝 Generating LLM summaries (batch processing)...');
  const startTime = Date.now();
  
  const videoData = await generateBatchSummaries(videos, 10); // Process 10 at a time
  
  const summaryTime = Date.now() - startTime;
  console.log(`\n✅ Generated ${videoData.length} summaries in ${(summaryTime/1000).toFixed(1)}s\n`);
  
  // Show sample summaries
  console.log('📋 Sample Summaries:');
  for (let i = 0; i < Math.min(5, videoData.length); i++) {
    console.log(`\n${i+1}. "${videoData[i].title.substring(0, 50)}..."`);
    console.log(`   Summary: ${videoData[i].summary}`);
  }
  
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
    'llm_summary_embeddings.json',
    JSON.stringify(outputData, null, 2)
  );
  
  console.log('\n💾 Saved embeddings to llm_summary_embeddings.json');
  console.log('   Ready for BERTopic analysis');
  
  // Cost calculation
  const avgDescLength = videos.reduce((sum, v) => sum + v.description.substring(0, 1000).length, 0) / videos.length;
  const tokensPerVideo = (SUMMARY_PROMPT.length + avgDescLength + 100) / 4; // Rough token estimate
  const totalSummaryTokens = videoData.length * tokensPerVideo;
  
  const embeddingChars = titleTexts.join(' ').length + combinedTexts.join(' ').length;
  const embeddingTokens = embeddingChars / 4; // Rough estimate
  
  const summaryCost = (totalSummaryTokens / 1000000) * 0.150; // GPT-4o-mini pricing
  const embeddingCost = (embeddingTokens / 1000000) * 0.020; // text-embedding-3-small pricing
  
  console.log('\n💰 Cost Analysis:');
  console.log(`  Videos processed: ${videoData.length}`);
  console.log(`  Summary generation: $${summaryCost.toFixed(2)}`);
  console.log(`  Embeddings: $${embeddingCost.toFixed(2)}`);
  console.log(`  Total for test: $${(summaryCost + embeddingCost).toFixed(2)}`);
  console.log(`  \nProjected cost for 170K videos: $${((summaryCost + embeddingCost) * 170000 / videoData.length).toFixed(2)}`);
  
  // For OpenAI Batch API (50% discount, 24hr processing)
  const batchCost = (summaryCost * 0.5);
  console.log(`  \nWith Batch API (24hr): $${(batchCost * 170000 / videoData.length).toFixed(2)} for 170K videos`);
}

testLLMSummariesWithBERTopic().catch(console.error);