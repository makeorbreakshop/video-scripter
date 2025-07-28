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

async function generateVideoSummary(video) {
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
          content: `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description?.substring(0, 1500) || 'No description'}`
        }
      ],
      temperature: 0.3,
      max_tokens: 100
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generating summary:', error.message);
    return null;
  }
}

async function generateBatchEmbeddings(texts) {
  try {
    const response = await openai.embeddings.create({
      input: texts,
      model: 'text-embedding-3-small'
    });
    return response.data.map(item => item.embedding);
  } catch (error) {
    console.error('Error generating embeddings:', error);
    return [];
  }
}

async function testLLMSummariesWithBERTopic() {
  console.log('🧠 Testing LLM Summaries with BERTopic (400 videos)\n');
  
  // Get videos with substantial descriptions
  const { data: allVideos, error } = await supabase
    .from('videos')
    .select('id, title, description, channel_name, view_count')
    .not('description', 'is', null)
    .order('view_count', { ascending: false })
    .limit(1000);  // Get extra to filter
  
  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }
  
  // Filter for videos with meaningful descriptions
  const videos = allVideos
    .filter(v => v.description && v.description.length >= 300)
    .slice(0, 400);
  
  console.log(`Found ${videos.length} videos with substantial descriptions\n`);
  
  // Generate summaries
  console.log('📝 Generating LLM summaries...');
  const videoData = [];
  
  for (let i = 0; i < videos.length; i++) {
    if ((i + 1) % 50 === 0) {
      console.log(`  Processed ${i + 1}/${videos.length} videos...`);
    }
    
    const summary = await generateVideoSummary(videos[i]);
    
    if (summary) {
      videoData.push({
        id: videos[i].id,
        title: videos[i].title,
        channel: videos[i].channel_name,
        summary: summary,
        title_plus_summary: `${videos[i].title} | ${summary}`
      });
    }
    
    // Rate limiting
    if (i % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  console.log(`\n✅ Generated ${videoData.length} summaries\n`);
  
  // Show sample summaries
  console.log('📋 Sample Summaries:');
  for (let i = 0; i < 3; i++) {
    console.log(`\n${i+1}. "${videoData[i].title.substring(0, 50)}..."`);
    console.log(`   Summary: ${videoData[i].summary}`);
  }
  
  // Generate embeddings
  console.log('\n\n🔢 Generating embeddings...');
  
  // Title-only embeddings
  const titleTexts = videoData.map(v => v.title);
  const titleEmbeddings = [];
  
  console.log('  Generating title-only embeddings...');
  for (let i = 0; i < titleTexts.length; i += 100) {
    const batch = titleTexts.slice(i, i + 100);
    const embeddings = await generateBatchEmbeddings(batch);
    titleEmbeddings.push(...embeddings);
    console.log(`    Batch ${Math.floor(i/100) + 1}/${Math.ceil(titleTexts.length/100)} complete`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Title + Summary embeddings
  const combinedTexts = videoData.map(v => v.title_plus_summary);
  const combinedEmbeddings = [];
  
  console.log('\n  Generating title+summary embeddings...');
  for (let i = 0; i < combinedTexts.length; i += 100) {
    const batch = combinedTexts.slice(i, i + 100);
    const embeddings = await generateBatchEmbeddings(batch);
    combinedEmbeddings.push(...embeddings);
    console.log(`    Batch ${Math.floor(i/100) + 1}/${Math.ceil(combinedTexts.length/100)} complete`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
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
  const tokensUsed = videoData.length * 500; // Approx tokens per summary
  const embeddingTokens = (titleTexts.join(' ').length + combinedTexts.join(' ').length) / 4; // Rough estimate
  const summaryCost = (tokensUsed / 1000000) * 0.150;
  const embeddingCost = (embeddingTokens / 1000000) * 0.020;
  
  console.log('\n💰 Cost for this test:');
  console.log(`  Summaries: $${summaryCost.toFixed(2)}`);
  console.log(`  Embeddings: $${embeddingCost.toFixed(2)}`);
  console.log(`  Total: $${(summaryCost + embeddingCost).toFixed(2)}`);
}

testLLMSummariesWithBERTopic().catch(console.error);