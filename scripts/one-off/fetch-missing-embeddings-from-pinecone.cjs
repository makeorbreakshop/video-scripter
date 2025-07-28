const { createClient } = require('@supabase/supabase-js');
const { Pinecone } = require('@pinecone-database/pinecone');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

async function fetchMissingEmbeddings() {
  console.log('🔍 Fetching Missing Embeddings from Pinecone');
  console.log('==========================================\n');
  
  try {
    // Connect to Pinecone index
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME || 'youtube-titles-prod');
    console.log('✅ Connected to Pinecone index\n');
    
    // Load existing aggregated embeddings to know what we already have
    console.log('📂 Loading existing aggregated embeddings...');
    const existingData = JSON.parse(fs.readFileSync('exports/title-embeddings-complete-aggregated.json', 'utf8'));
    const existingIds = new Set((existingData.embeddings || []).map(e => e.id));
    console.log(`✅ Found ${existingIds.size} existing embeddings\n`);
    
    // Get videos that need topics and have Pinecone embeddings
    console.log('🔍 Finding videos that need embeddings...');
    const videosNeedingEmbeddings = [];
    let offset = 0;
    
    while (true) {
      const { data, error } = await supabase
        .from('videos')
        .select('id, title, channel_id, channel_name, published_at')
        .is('topic_level_1', null)
        .not('channel_id', 'is', null)
        .not('pinecone_embedding_version', 'is', null)
        .range(offset, offset + 999);
        
      if (error) throw error;
      if (!data || data.length === 0) break;
      
      // Filter out videos we already have locally
      const newVideos = data.filter(v => !existingIds.has(v.id));
      videosNeedingEmbeddings.push(...newVideos);
      
      if (data.length < 1000) break;
      offset += 1000;
    }
    
    console.log(`📹 Found ${videosNeedingEmbeddings.length} videos needing embeddings\n`);
    
    if (videosNeedingEmbeddings.length === 0) {
      console.log('No new embeddings to fetch!');
      return;
    }
    
    // Fetch embeddings in batches
    const BATCH_SIZE = 100; // Pinecone fetch limit
    const allEmbeddings = [];
    let successCount = 0;
    let errorCount = 0;
    
    console.log('🔄 Fetching embeddings from Pinecone...');
    
    for (let i = 0; i < videosNeedingEmbeddings.length; i += BATCH_SIZE) {
      const batch = videosNeedingEmbeddings.slice(i, i + BATCH_SIZE);
      const videoIds = batch.map(v => v.id);
      
      try {
        // Fetch embeddings from Pinecone
        const fetchResponse = await index.fetch(videoIds);
        
        for (const video of batch) {
          const vectorData = fetchResponse.records[video.id];
          if (!vectorData || !vectorData.values) {
            console.log(`⚠️  No embedding found for video ${video.id}`);
            errorCount++;
            continue;
          }
          
          // Store embedding with metadata
          allEmbeddings.push({
            id: video.id,
            values: vectorData.values,
            metadata: {
              title: video.title,
              channel_id: video.channel_id,
              channel_name: video.channel_name,
              published_at: video.published_at
            }
          });
          successCount++;
        }
        
        // Progress update
        const progress = Math.round((i + batch.length) / videosNeedingEmbeddings.length * 100);
        console.log(`   📊 Progress: ${i + batch.length}/${videosNeedingEmbeddings.length} (${progress}%) - Success: ${successCount}, Errors: ${errorCount}`);
        
      } catch (error) {
        console.error(`❌ Error fetching batch:`, error.message);
        errorCount += batch.length;
      }
    }
    
    console.log(`\n✅ Fetched ${successCount} embeddings`);
    console.log(`❌ Failed to fetch ${errorCount} embeddings\n`);
    
    // Save the new embeddings
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const outputFile = `exports/title-embeddings-pinecone-${timestamp}.json`;
    
    const output = {
      export_info: {
        timestamp: new Date().toISOString(),
        source: 'pinecone',
        total_videos: allEmbeddings.length,
        description: 'Missing embeddings fetched from Pinecone'
      },
      vectors: allEmbeddings // Using 'vectors' to match other export files
    };
    
    console.log(`💾 Saving ${allEmbeddings.length} embeddings to ${outputFile}...`);
    fs.writeFileSync(outputFile, JSON.stringify(output));
    
    console.log('\n✨ Export Complete!');
    console.log('====================');
    console.log(`📄 Output file: ${outputFile}`);
    console.log(`📊 Total embeddings saved: ${allEmbeddings.length}`);
    
    // Now update the aggregated file
    console.log('\n🔄 Updating aggregated embeddings file...');
    
    // Add new embeddings to existing ones
    const updatedEmbeddings = [...existingData.embeddings, ...allEmbeddings];
    
    const updatedOutput = {
      export_info: {
        timestamp: new Date().toISOString(),
        total_videos: updatedEmbeddings.length,
        files_processed: (existingData.export_info?.files_processed || 0) + 1,
        source_files: (existingData.export_info?.source_files || 0) + 1,
        last_update: 'Added Pinecone embeddings for missing videos'
      },
      embeddings: updatedEmbeddings
    };
    
    fs.writeFileSync('exports/title-embeddings-complete-aggregated.json', JSON.stringify(updatedOutput));
    console.log(`✅ Updated aggregated file. Total embeddings: ${updatedEmbeddings.length}`);
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    console.error('Stack:', error.stack);
  }
}

fetchMissingEmbeddings().catch(console.error);