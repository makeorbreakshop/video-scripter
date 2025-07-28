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

async function generateVideoSummary(video) {
  const prompt = `Based on this YouTube video information, write a concise 1-2 sentence summary focusing on the main topic and content type. Ignore sponsorships, links, and channel promotions.

Title: ${video.title}
Channel: ${video.channel_name}
Description: ${video.description?.substring(0, 1500) || 'No description'}

Write only the summary, no other text:`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 100
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generating summary:', error);
    return null;
  }
}

async function testDescriptionSummaries() {
  console.log('🧠 Testing LLM Description Summaries for BERTopic\n');
  
  // Get a diverse sample of videos with descriptions
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, description, channel_name, view_count')
    .not('description', 'is', null)
    .gte('char_length(description)', 200)  // At least 200 chars
    .order('view_count', { ascending: false })
    .limit(100);
  
  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }
  
  console.log(`Found ${videos.length} videos with substantial descriptions\n`);
  
  // Test on a few examples first
  console.log('📝 Sample Summaries:\n');
  
  for (let i = 0; i < 5; i++) {
    const video = videos[i];
    console.log(`Video ${i + 1}: ${video.title.substring(0, 60)}...`);
    console.log(`Channel: ${video.channel_name}`);
    
    const summary = await generateVideoSummary(video);
    console.log(`Summary: ${summary}`);
    console.log('---\n');
  }
  
  // Now process all videos
  console.log('🔄 Generating summaries for all videos...\n');
  
  const results = [];
  let successCount = 0;
  
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    
    if ((i + 1) % 10 === 0) {
      console.log(`Processing ${i + 1}/${videos.length}...`);
    }
    
    const summary = await generateVideoSummary(video);
    
    if (summary) {
      successCount++;
      results.push({
        id: video.id,
        title: video.title,
        channel_name: video.channel_name,
        summary: summary,
        combined_text: `${video.title} | ${summary}`,
        description_length: video.description.length,
        summary_length: summary.length
      });
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`\n✅ Generated ${successCount}/${videos.length} summaries successfully`);
  
  // Calculate statistics
  const avgDescLength = videos.reduce((sum, v) => sum + v.description.length, 0) / videos.length;
  const avgSummaryLength = results.reduce((sum, r) => sum + r.summary_length, 0) / results.length;
  
  console.log('\n📊 Statistics:');
  console.log(`- Average description length: ${Math.round(avgDescLength)} chars`);
  console.log(`- Average summary length: ${Math.round(avgSummaryLength)} chars`);
  console.log(`- Compression ratio: ${(avgSummaryLength / avgDescLength * 100).toFixed(1)}%`);
  
  // Save results
  await fs.writeFile(
    'video_llm_summaries.json',
    JSON.stringify(results, null, 2)
  );
  
  console.log('\n💾 Saved results to video_llm_summaries.json');
  
  // Cost estimate
  const tokensUsed = videos.length * 400; // ~400 tokens per video (prompt + response)
  const cost = (tokensUsed / 1000000) * 0.150; // $0.150 per 1M input tokens for gpt-4o-mini
  
  console.log('\n💰 Cost Analysis:');
  console.log(`- Videos processed: ${videos.length}`);
  console.log(`- Estimated tokens: ${tokensUsed.toLocaleString()}`);
  console.log(`- Estimated cost: $${cost.toFixed(2)}`);
  console.log(`- Cost for 170K videos: $${(cost * 1700).toFixed(2)}`);
}

testDescriptionSummaries().catch(console.error);