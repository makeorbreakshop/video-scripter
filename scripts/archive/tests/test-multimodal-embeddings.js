#!/usr/bin/env node

/**
 * Test combining title and thumbnail embeddings for better BERTopic clustering
 * Compares title-only vs title+thumbnail multimodal approach
 */

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
  apiKey: process.env.OPENAI_API_KEY
});

// CLIP model for thumbnail embeddings (768D)
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

async function getVideosForTesting(limit = 100) {
  console.log(`📹 Fetching ${limit} videos for testing...`);
  
  // Get popular videos with thumbnails
  const { data: videos } = await supabase
    .from('videos')
    .select('id, title, thumbnail_url, channel_title, view_count')
    .not('thumbnail_url', 'is', null)
    .gte('view_count', 10000) // Popular videos
    .order('view_count', { ascending: false })
    .limit(limit);

  console.log(`Found ${videos?.length || 0} videos with thumbnails`);
  return videos || [];
}

async function generateTitleEmbedding(title) {
  const response = await openai.embeddings.create({
    input: title,
    model: "text-embedding-3-small",
    dimensions: 512
  });
  return response.data[0].embedding;
}

async function generateThumbnailEmbedding(thumbnailUrl) {
  // Using Replicate's CLIP model for image embeddings
  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Token ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      version: "75b33f253f7714a281ad3e9b28f63e3232d583716ef6718f2e46641077ea040a",
      input: {
        inputs: thumbnailUrl,
        task: "feature_extraction"
      }
    })
  });

  const prediction = await response.json();
  
  // Wait for completion
  let result = prediction;
  while (result.status === "starting" || result.status === "processing") {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const statusResponse = await fetch(
      `https://api.replicate.com/v1/predictions/${result.id}`,
      {
        headers: {
          "Authorization": `Token ${REPLICATE_API_TOKEN}`,
        },
      }
    );
    result = await statusResponse.json();
  }

  if (result.status === "succeeded") {
    return result.output; // 768D CLIP embedding
  } else {
    throw new Error(`Thumbnail embedding failed: ${result.error}`);
  }
}

async function combineEmbeddings(titleEmb, thumbEmb) {
  // Strategy 1: Concatenate (512D + 768D = 1280D)
  const concatenated = [...titleEmb, ...thumbEmb];
  
  // Strategy 2: Weighted average (normalize to 512D)
  // Resample thumbnail embedding from 768D to 512D
  const resampledThumb = [];
  const ratio = thumbEmb.length / titleEmb.length;
  for (let i = 0; i < titleEmb.length; i++) {
    const thumbIndex = Math.floor(i * ratio);
    resampledThumb.push(thumbEmb[thumbIndex]);
  }
  
  // Weight: 70% title, 30% thumbnail (since title is more semantic)
  const weighted = titleEmb.map((val, i) => 
    0.7 * val + 0.3 * resampledThumb[i]
  );

  return {
    concatenated,
    weighted
  };
}

async function processVideos() {
  const videos = await getVideosForTesting(50); // Start with 50 for testing
  
  if (videos.length === 0) {
    console.log('❌ No videos found for testing');
    return;
  }

  console.log('\n🚀 Generating embeddings...\n');

  const results = [];
  
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    console.log(`Processing ${i + 1}/${videos.length}: ${video.title}`);
    
    try {
      // Generate title embedding
      const titleEmb = await generateTitleEmbedding(video.title);
      
      // Generate thumbnail embedding
      const thumbEmb = await generateThumbnailEmbedding(video.thumbnail_url);
      
      // Combine embeddings
      const combined = await combineEmbeddings(titleEmb, thumbEmb);
      
      results.push({
        video_id: video.id,
        title: video.title,
        channel: video.channel_title,
        view_count: video.view_count,
        title_embedding: titleEmb,
        thumbnail_embedding: thumbEmb,
        concatenated_embedding: combined.concatenated,
        weighted_embedding: combined.weighted
      });
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
    }
  }

  // Save results for BERTopic analysis
  await fs.writeFile(
    'multimodal_embeddings.json',
    JSON.stringify(results, null, 2)
  );

  console.log(`\n✅ Saved ${results.length} videos with multimodal embeddings`);
  console.log('\nEmbedding dimensions:');
  console.log('- Title only: 512D');
  console.log('- Thumbnail only: 768D');
  console.log('- Concatenated: 1280D');
  console.log('- Weighted: 512D');
  
  return results;
}

async function createComparisonData(results) {
  // Create datasets for BERTopic comparison
  const datasets = {
    title_only: results.map(r => ({
      id: r.video_id,
      embedding: r.title_embedding,
      metadata: { title: r.title, channel: r.channel }
    })),
    
    multimodal_concat: results.map(r => ({
      id: r.video_id,
      embedding: r.concatenated_embedding,
      metadata: { title: r.title, channel: r.channel }
    })),
    
    multimodal_weighted: results.map(r => ({
      id: r.video_id,
      embedding: r.weighted_embedding,
      metadata: { title: r.title, channel: r.channel }
    }))
  };

  // Save for Python BERTopic analysis
  await fs.writeFile(
    'bertopic_comparison_data.json',
    JSON.stringify(datasets, null, 2)
  );

  console.log('\n📊 Created comparison datasets:');
  console.log('1. title_only - Traditional approach');
  console.log('2. multimodal_concat - Title + Thumbnail concatenated');
  console.log('3. multimodal_weighted - 70% Title + 30% Thumbnail');
}

// Main execution
(async () => {
  try {
    console.log('🎯 Multimodal Embedding Test\n');
    console.log('This test will compare BERTopic clustering quality between:');
    console.log('1. Title embeddings only (current approach)');
    console.log('2. Title + Thumbnail multimodal embeddings\n');
    
    const results = await processVideos();
    
    if (results.length > 0) {
      await createComparisonData(results);
      console.log('\n✅ Ready for BERTopic analysis!');
      console.log('Next: Run compare-multimodal-bertopic.py');
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
})();