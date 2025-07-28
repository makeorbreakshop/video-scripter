#!/usr/bin/env node

/**
 * Fetch existing title and thumbnail embeddings from Pinecone
 * for multimodal BERTopic comparison
 */

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import fs from 'fs/promises';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

async function fetchMultimodalEmbeddings(limit = 1000) {
  console.log(`🎯 Fetching ${limit} videos with both title and thumbnail embeddings\n`);

  // Get indexes
  const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
  const thumbIndex = pinecone.index(process.env.PINECONE_THUMBNAIL_INDEX_NAME);

  // Get a batch of videos that likely have both embeddings
  const { data: videos } = await supabase
    .from('videos')
    .select('id, title, channel_name, view_count')
    .gt('view_count', 100000) // Popular videos more likely to have both
    .order('view_count', { ascending: false })
    .limit(limit * 2); // Get extra in case some are missing

  console.log(`Found ${videos?.length || 0} popular videos to check\n`);

  const results = [];
  let found = 0;

  for (const video of videos || []) {
    if (found >= limit) break;
    
    try {
      // Fetch title embedding from Pinecone
      const titleResult = await titleIndex.fetch([video.id]);
      const titleVector = titleResult.records[video.id]?.values;

      if (!titleVector) continue;

      // Fetch thumbnail embedding from Pinecone  
      const thumbResult = await thumbIndex.fetch([video.id]);
      const thumbVector = thumbResult.records[video.id]?.values;

      if (!thumbVector) continue;

      // We have both!
      results.push({
        video_id: video.id,
        title: video.title,
        channel: video.channel_name,
        view_count: video.view_count,
        title_embedding: titleVector,
        thumbnail_embedding: thumbVector
      });

      found++;
      
      if (found % 100 === 0) {
        console.log(`✅ Found ${found} videos with both embeddings...`);
      }

    } catch (error) {
      // Skip this video
    }
  }

  console.log(`\n📊 Successfully fetched ${results.length} videos with multimodal embeddings`);
  
  // Create combined embeddings
  console.log('\n🔄 Creating combined embeddings...');
  
  for (const result of results) {
    // Strategy 1: Concatenate (512D + 768D = 1280D)
    result.concatenated_embedding = [
      ...result.title_embedding,
      ...result.thumbnail_embedding
    ];

    // Strategy 2: Weighted average (need to normalize dimensions)
    // Resample thumbnail from 768D to 512D
    const resampledThumb = [];
    const ratio = result.thumbnail_embedding.length / result.title_embedding.length;
    for (let i = 0; i < result.title_embedding.length; i++) {
      const thumbIndex = Math.floor(i * ratio);
      resampledThumb.push(result.thumbnail_embedding[thumbIndex]);
    }
    
    // 70% title, 30% thumbnail
    result.weighted_embedding = result.title_embedding.map((val, i) => 
      0.7 * val + 0.3 * resampledThumb[i]
    );
  }

  // Save for analysis
  await fs.writeFile(
    'multimodal_embeddings.json',
    JSON.stringify(results, null, 2)
  );

  // Create BERTopic comparison data
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

  await fs.writeFile(
    'bertopic_comparison_data.json',
    JSON.stringify(datasets, null, 2)
  );

  console.log('\n✅ Data ready for BERTopic analysis!');
  console.log(`\nEmbedding dimensions:`);
  console.log(`- Title: ${results[0]?.title_embedding.length}D`);
  console.log(`- Thumbnail: ${results[0]?.thumbnail_embedding.length}D`);
  console.log(`- Concatenated: ${results[0]?.concatenated_embedding.length}D`);
  console.log(`- Weighted: ${results[0]?.weighted_embedding.length}D`);

  return results;
}

// Main execution
(async () => {
  try {
    await fetchMultimodalEmbeddings(500); // Get 500 videos for testing
    console.log('\n🎯 Next: Run python scripts/compare-multimodal-bertopic.py');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
})();