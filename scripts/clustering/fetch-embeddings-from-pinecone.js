import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fetchAllEmbeddings() {
  console.log('🚀 Starting to fetch embeddings from Pinecone...');
  
  try {
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
    
    // First, get all video IDs from Supabase
    console.log('📊 Fetching video metadata from Supabase...');
    let allVideos = [];
    let offset = 0;
    const batchSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from('videos')
        .select('id, title, channel_id, channel_name, view_count, topic_cluster, topic_level_3')
        .range(offset, offset + batchSize - 1);
      
      if (error) {
        console.error('Error fetching videos:', error);
        break;
      }
      
      if (!data || data.length === 0) break;
      
      allVideos = allVideos.concat(data);
      offset += batchSize;
      console.log(`  Loaded ${allVideos.length} videos...`);
      
      if (data.length < batchSize) break;
    }
    
    console.log(`✅ Loaded ${allVideos.length} videos total`);
    
    // Now fetch embeddings from Pinecone in batches
    console.log('\n🔍 Fetching embeddings from Pinecone...');
    const embeddings = [];
    const notFound = [];
    
    // Process in chunks
    const chunkSize = 100;
    for (let i = 0; i < allVideos.length; i += chunkSize) {
      const chunk = allVideos.slice(i, i + chunkSize);
      const ids = chunk.map(v => v.id);
      
      try {
        // Fetch vectors from Pinecone
        const response = await index.fetch(ids);
        
        // Process each video
        for (const video of chunk) {
          if (response.records && response.records[video.id]) {
            const vector = response.records[video.id];
            embeddings.push({
              id: video.id,
              title: video.title,
              channel_id: video.channel_id,
              channel_name: video.channel_name,
              view_count: video.view_count,
              topic_cluster: video.topic_cluster,
              topic_level_3: video.topic_level_3,
              embedding: vector.values
            });
          } else {
            notFound.push(video.id);
          }
        }
      } catch (error) {
        console.error(`Error fetching batch ${i/chunkSize + 1}:`, error);
      }
      
      if (i % 1000 === 0) {
        console.log(`  Progress: ${i}/${allVideos.length} videos processed...`);
      }
    }
    
    console.log(`\n✅ Successfully fetched ${embeddings.length} embeddings`);
    if (notFound.length > 0) {
      console.log(`⚠️  ${notFound.length} videos not found in Pinecone`);
    }
    
    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `title-embeddings-from-pinecone-${timestamp}.json`;
    
    const exportData = {
      export_info: {
        timestamp: new Date().toISOString(),
        total_videos: allVideos.length,
        embeddings_found: embeddings.length,
        missing: notFound.length,
        source: 'pinecone',
        dimension: 512
      },
      embeddings: embeddings
    };
    
    fs.writeFileSync(filename, JSON.stringify(exportData, null, 2));
    console.log(`\n💾 Saved embeddings to: ${filename}`);
    
    // Also save a smaller sample for testing
    const sampleData = {
      ...exportData,
      embeddings: embeddings.slice(0, 5000)
    };
    
    fs.writeFileSync(`sample-${filename}`, JSON.stringify(sampleData, null, 2));
    console.log(`💾 Saved sample (5000) to: sample-${filename}`);
    
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

// Run the script
fetchAllEmbeddings();