import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getExistingVideoIds() {
  console.log('📂 Loading existing embeddings...');
  const aggregatedFile = '/Users/brandoncullum/video-scripter/exports/title-embeddings-complete-aggregated.json';
  
  const data = JSON.parse(fs.readFileSync(aggregatedFile, 'utf8'));
  const existingIds = new Set(data.embeddings.map(e => e.id));
  
  console.log(`✅ Found ${existingIds.size:,} existing embeddings`);
  return existingIds;
}

async function fetchRemainingEmbeddings() {
  console.log('🚀 Fetching remaining embeddings from Pinecone...');
  
  try {
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
    
    // Get existing video IDs
    const existingIds = await getExistingVideoIds();
    
    // Get all video IDs from database
    console.log('\n📊 Fetching all video IDs from Supabase...');
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    console.log(`Total videos in database: ${totalVideos?.toLocaleString()}`);
    
    // Fetch video IDs in batches
    let allVideoIds = [];
    let offset = 0;
    const batchSize = 1000;
    
    while (offset < totalVideos) {
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
        allVideoIds = allVideoIds.concat(data.map(v => v.id));
        if (offset % 10000 === 0) {
          console.log(`  Loaded ${allVideoIds.length}/${totalVideos} video IDs...`);
        }
      }
      
      if (!data || data.length < batchSize) break;
      offset += batchSize;
    }
    
    // Filter out existing IDs
    const remainingIds = allVideoIds.filter(id => !existingIds.has(id));
    console.log(`\n📊 Need to fetch ${remainingIds.length:,} remaining embeddings`);
    
    if (remainingIds.length === 0) {
      console.log('✅ All embeddings already fetched!');
      return;
    }
    
    // Fetch remaining embeddings in chunks
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const chunkSize = 30000; // Save every 30K embeddings
    let currentChunk = [];
    let chunkNumber = 0;
    let totalFetched = 0;
    let notFound = [];
    
    // Process in batches of 100 (Pinecone limit)
    for (let i = 0; i < remainingIds.length; i += 100) {
      const ids = remainingIds.slice(i, i + 100);
      
      try {
        const response = await index.fetch(ids);
        
        for (const videoId of ids) {
          if (response.records && response.records[videoId]) {
            const vector = response.records[videoId];
            currentChunk.push({
              id: videoId,
              values: vector.values,
              metadata: vector.metadata || {}
            });
            totalFetched++;
            
            // Save chunk when it reaches size limit
            if (currentChunk.length >= chunkSize) {
              chunkNumber++;
              const chunkFile = `remaining-embeddings-chunk-${chunkNumber}-${timestamp}.json`;
              
              fs.writeFileSync(chunkFile, JSON.stringify({
                chunk_info: {
                  chunk_number: chunkNumber,
                  embeddings_count: currentChunk.length,
                  timestamp: new Date().toISOString()
                },
                embeddings: currentChunk
              }, null, 2));
              
              console.log(`  ✅ Saved chunk ${chunkNumber}: ${chunkFile} (${currentChunk.length:,} embeddings)`);
              currentChunk = [];
            }
          } else {
            notFound.push(videoId);
          }
        }
      } catch (error) {
        console.error(`Error fetching batch:`, error.message);
      }
      
      // Progress update
      if (i % 10000 === 0) {
        console.log(`  Progress: ${i}/${remainingIds.length} (${totalFetched:,} found)`);
      }
    }
    
    // Save final chunk
    if (currentChunk.length > 0) {
      chunkNumber++;
      const chunkFile = `remaining-embeddings-chunk-${chunkNumber}-${timestamp}.json`;
      
      fs.writeFileSync(chunkFile, JSON.stringify({
        chunk_info: {
          chunk_number: chunkNumber,
          embeddings_count: currentChunk.length,
          timestamp: new Date().toISOString()
        },
        embeddings: currentChunk
      }, null, 2));
      
      console.log(`  ✅ Saved final chunk ${chunkNumber}: ${chunkFile} (${currentChunk.length:,} embeddings)`);
    }
    
    // Save summary
    const summaryFile = `remaining-embeddings-summary-${timestamp}.json`;
    fs.writeFileSync(summaryFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      total_videos_in_db: totalVideos,
      existing_embeddings: existingIds.size,
      attempted_to_fetch: remainingIds.length,
      successfully_fetched: totalFetched,
      not_found: notFound.length,
      chunks_created: chunkNumber
    }, null, 2));
    
    console.log(`\n✅ Fetch complete!`);
    console.log(`   Fetched: ${totalFetched:,} embeddings`);
    console.log(`   Not found: ${notFound.length:,}`);
    console.log(`   Saved in ${chunkNumber} chunks`);
    console.log(`   Summary: ${summaryFile}`);
    
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

// Run the script
fetchRemainingEmbeddings();