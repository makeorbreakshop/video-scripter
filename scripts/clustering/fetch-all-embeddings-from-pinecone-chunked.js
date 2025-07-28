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
          console.log(`  No more data at offset ${offset}`);
          break;
        }
        
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
    const notFound = [];
    const errors = [];
    
    // Convert Set to Array for processing
    const videoIdArray = Array.from(videoIds);
    
    // Set up for chunked saving
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const saveChunkSize = 50000;
    let currentChunk = [];
    let chunkNumber = 0;
    let totalEmbeddings = 0;
    const chunkFiles = [];
    
    // Process in chunks of 100 (Pinecone limit)
    const fetchChunkSize = 100;
    
    for (let i = 0; i < videoIdArray.length; i += fetchChunkSize) {
      const ids = videoIdArray.slice(i, i + fetchChunkSize);
      
      try {
        // Fetch vectors from Pinecone
        const response = await index.fetch(ids);
        
        // Process each video
        for (const videoId of ids) {
          if (response.records && response.records[videoId]) {
            const vector = response.records[videoId];
            // Add to current chunk
            currentChunk.push({
              id: videoId,
              values: vector.values,
              metadata: vector.metadata || {}
            });
            totalEmbeddings++;
            
            // Save chunk when it reaches the size limit
            if (currentChunk.length >= saveChunkSize) {
              chunkNumber++;
              const chunkFile = `embeddings-chunk-${chunkNumber}-${timestamp}.json`;
              
              const chunkData = {
                chunk_info: {
                  chunk_number: chunkNumber,
                  embeddings_in_chunk: currentChunk.length,
                  start_index: (chunkNumber - 1) * saveChunkSize,
                  end_index: (chunkNumber - 1) * saveChunkSize + currentChunk.length
                },
                embeddings: currentChunk
              };
              
              fs.writeFileSync(chunkFile, JSON.stringify(chunkData, null, 2));
              chunkFiles.push(chunkFile);
              console.log(`  ✅ Saved chunk ${chunkNumber}: ${chunkFile} (${currentChunk.length} embeddings)`);
              
              // Reset current chunk
              currentChunk = [];
            }
          } else {
            notFound.push(videoId);
          }
        }
      } catch (error) {
        console.error(`Error fetching batch ${Math.floor(i/fetchChunkSize) + 1}:`, error.message);
        errors.push({ batch: Math.floor(i/fetchChunkSize) + 1, error: error.message });
      }
      
      // Progress update every 10K videos
      if (i % 10000 === 0) {
        console.log(`  Progress: ${i}/${videoIdArray.length} videos processed (${totalEmbeddings} embeddings found)...`);
      }
    }
    
    // Save any remaining embeddings in the last chunk
    if (currentChunk.length > 0) {
      chunkNumber++;
      const chunkFile = `embeddings-chunk-${chunkNumber}-${timestamp}.json`;
      
      const chunkData = {
        chunk_info: {
          chunk_number: chunkNumber,
          embeddings_in_chunk: currentChunk.length,
          start_index: (chunkNumber - 1) * saveChunkSize,
          end_index: (chunkNumber - 1) * saveChunkSize + currentChunk.length
        },
        embeddings: currentChunk
      };
      
      fs.writeFileSync(chunkFile, JSON.stringify(chunkData, null, 2));
      chunkFiles.push(chunkFile);
      console.log(`  ✅ Saved final chunk ${chunkNumber}: ${chunkFile} (${currentChunk.length} embeddings)`);
    }
    
    console.log(`\n✅ Successfully fetched ${totalEmbeddings} embeddings`);
    console.log(`⚠️  ${notFound.length} videos not found in Pinecone`);
    if (errors.length > 0) {
      console.log(`❌ ${errors.length} batch errors occurred`);
    }
    
    // Save metadata file
    const metadataFile = `embeddings-metadata-${timestamp}.json`;
    const metadata = {
      timestamp: new Date().toISOString(),
      total_videos_in_db: totalVideos,
      total_videos_fetched: allVideos.length,
      embeddings_found: totalEmbeddings,
      missing: notFound.length,
      source: 'pinecone_complete',
      dimension: 512,
      errors: errors.length,
      chunks: chunkNumber,
      chunk_size: saveChunkSize,
      files: chunkFiles
    };
    
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
    console.log(`  Embeddings found: ${totalEmbeddings.toLocaleString()}`);
    console.log(`  Missing embeddings: ${notFound.length.toLocaleString()}`);
    console.log(`  Coverage: ${(totalEmbeddings / totalVideos * 100).toFixed(1)}%`);
    console.log(`  Saved in ${chunkNumber} chunks`);
    
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

// Run the script
fetchAllEmbeddings();