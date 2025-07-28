import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from parent directory
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Verify environment variables
if (!process.env.PINECONE_API_KEY) {
  throw new Error('PINECONE_API_KEY environment variable is required');
}
if (!process.env.PINECONE_INDEX_NAME) {
  throw new Error('PINECONE_INDEX_NAME environment variable is required');
}

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
  console.log('🚀 Starting to fetch ALL embeddings from Pinecone...');
  
  try {
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
    
    // First, get total count of videos in database
    console.log('📊 Getting total video count from Supabase...');
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    console.log(`✅ Total videos in database: ${totalVideos?.toLocaleString()}`);
    
    // Get all video IDs - fetch in smaller batches to avoid the 1000 limit
    console.log('\n📊 Fetching all video IDs from Supabase...');
    let allVideos = [];
    let offset = 0;
    const batchSize = 1000; // Max reliable batch size
    
    // Keep fetching until we have all videos
    while (offset < totalVideos) {
      try {
        // Use limit instead of range to avoid issues
        const { data, error } = await supabase
          .from('videos')
          .select('id')
          .order('id')
          .range(offset, offset + batchSize - 1);
        
        if (error) {
          console.error(`Error at offset ${offset}:`, error);
          offset += batchSize;
          continue;
        }
        
        if (data && data.length > 0) {
          allVideos = allVideos.concat(data);
          if (offset % 10000 === 0 || allVideos.length === totalVideos) {
            console.log(`  Loaded ${allVideos.length}/${totalVideos} video IDs...`);
          }
        } else {
          // No more data
          console.log(`  No more data at offset ${offset}`);
          break;
        }
        
        // Stop if we got less than a full batch
        if (data.length < batchSize) {
          console.log(`  Reached end of data at ${allVideos.length} videos`);
          break;
        }
        
        offset += batchSize;
        
        // Small delay every 50K to avoid rate limiting
        if (offset % 50000 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (err) {
        console.error(`Unexpected error at offset ${offset}:`, err);
        offset += batchSize;
      }
    }
    
    console.log(`✅ Loaded ${allVideos.length} videos total`);
    
    // Just store IDs in a Set for now
    const videoIds = new Set(allVideos.map(v => v.id));
    
    // Now fetch embeddings from Pinecone in batches
    console.log('\n🔍 Fetching embeddings from Pinecone...');
    const embeddings = [];
    const notFound = [];
    const errors = [];
    
    // Convert Set to Array for processing
    const videoIdArray = Array.from(videoIds);
    
    // Process in chunks of 100 (Pinecone limit)
    const chunkSize = 100;
    for (let i = 0; i < videoIdArray.length; i += chunkSize) {
      const ids = videoIdArray.slice(i, i + chunkSize);
      
      try {
        // Fetch vectors from Pinecone
        const response = await index.fetch(ids);
        
        // Process each video
        for (const videoId of ids) {
          if (response.records && response.records[videoId]) {
            const vector = response.records[videoId];
            // Store embedding with minimal metadata from Pinecone
            embeddings.push({
              id: videoId,
              values: vector.values,
              metadata: vector.metadata || {}  // Use whatever metadata Pinecone has
            });
          } else {
            notFound.push(videoId);
          }
        }
      } catch (error) {
        console.error(`Error fetching batch ${Math.floor(i/chunkSize) + 1}:`, error.message);
        errors.push({ batch: Math.floor(i/chunkSize) + 1, error: error.message });
      }
      
      // Progress update every 10K videos
      if (i % 10000 === 0) {
        console.log(`  Progress: ${i}/${videoIdArray.length} videos processed (${embeddings.length} embeddings found)...`);
      }
    }
    
    console.log(`\n✅ Successfully fetched ${embeddings.length} embeddings`);
    console.log(`⚠️  ${notFound.length} videos not found in Pinecone`);
    if (errors.length > 0) {
      console.log(`❌ ${errors.length} batch errors occurred`);
    }
    
    // Save to file in batches to avoid memory issues
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `all-title-embeddings-${timestamp}.json`;
    
    // Save main file
    console.log('\n💾 Saving embeddings to file...');
    console.log(`   File will contain ${embeddings.length} embeddings`);
    
    // Save in chunks to avoid memory issues
    const saveChunkSize = 50000;
    const totalChunks = Math.ceil(embeddings.length / saveChunkSize);
    
    console.log(`   Splitting into ${totalChunks} chunks of ${saveChunkSize} embeddings each`);
    
    // Save metadata file
    const metadataFile = `embeddings-metadata-${timestamp}.json`;
    const metadata = {
      timestamp: new Date().toISOString(),
      total_videos_in_db: totalVideos,
      total_videos_fetched: allVideos.length,
      embeddings_found: embeddings.length,
      missing: notFound.length,
      source: 'pinecone_complete',
      dimension: 512,
      errors: errors.length,
      chunks: totalChunks,
      chunk_size: saveChunkSize,
      files: []
    };
    
    // Save each chunk
    for (let i = 0; i < totalChunks; i++) {
      const start = i * saveChunkSize;
      const end = Math.min((i + 1) * saveChunkSize, embeddings.length);
      const chunk = embeddings.slice(start, end);
      
      const chunkFile = `embeddings-chunk-${i + 1}-of-${totalChunks}-${timestamp}.json`;
      const chunkData = {
        chunk_info: {
          chunk_number: i + 1,
          total_chunks: totalChunks,
          embeddings_in_chunk: chunk.length,
          start_index: start,
          end_index: end
        },
        embeddings: chunk
      };
      
      fs.writeFileSync(chunkFile, JSON.stringify(chunkData, null, 2));
      metadata.files.push(chunkFile);
      console.log(`   ✅ Saved chunk ${i + 1}/${totalChunks}: ${chunkFile}`);
    }
    
    // Save metadata
    fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
    console.log(`\n✅ Saved metadata to: ${metadataFile}`);
    
    // Also save missing IDs for reference
    if (notFound.length > 0) {
      fs.writeFileSync(`missing-embeddings-${timestamp}.json`, JSON.stringify({
        missing_count: notFound.length,
        video_ids: notFound
      }, null, 2));
      console.log(`📝 Saved missing video IDs to: missing-embeddings-${timestamp}.json`);
    }
    
    // Summary
    console.log('\n📊 Final Summary:');
    console.log(`  Total videos in database: ${totalVideos?.toLocaleString()}`);
    console.log(`  Embeddings found: ${embeddings.length.toLocaleString()}`);
    console.log(`  Missing embeddings: ${notFound.length.toLocaleString()}`);
    console.log(`  Coverage: ${(embeddings.length / totalVideos * 100).toFixed(1)}%`);
    
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

// Run the script
fetchAllEmbeddings();