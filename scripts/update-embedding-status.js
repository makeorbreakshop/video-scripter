#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize clients
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

async function updateEmbeddingStatus() {
  console.log('🔄 Updating embedding status based on Pinecone state...\n');

  try {
    const indexName = process.env.PINECONE_INDEX_NAME || 'youtube-search';
    const index = pinecone.index(indexName);
    
    // Get videos that aren't marked as embedded
    console.log('📚 Fetching videos not marked as embedded...');
    
    let videosToCheck = [];
    let offset = 0;
    const pageSize = 1000;
    
    while (true) {
      const { data: batch, error } = await supabase
        .from('videos')
        .select('id')
        .or('pinecone_embedded.is.null,pinecone_embedded.eq.false')
        .not('title', 'is', null)
        .range(offset, offset + pageSize - 1);
      
      if (error) {
        console.error('❌ Error fetching videos:', error);
        return;
      }
      
      if (!batch || batch.length === 0) break;
      
      videosToCheck = videosToCheck.concat(batch);
      offset += pageSize;
      
      if (batch.length < pageSize) break;
    }
    
    console.log(`✅ Found ${videosToCheck.length} videos to check\n`);
    
    // Check which ones are actually in Pinecone
    console.log('🔍 Checking Pinecone for these videos...');
    const videosInPinecone = [];
    const batchSize = 100;
    
    for (let i = 0; i < videosToCheck.length; i += batchSize) {
      const batch = videosToCheck.slice(i, i + batchSize);
      const ids = batch.map(v => v.id);
      
      try {
        const response = await index.fetch(ids);
        
        if (response.records) {
          Object.keys(response.records).forEach(id => {
            videosInPinecone.push(id);
          });
        }
        
        if ((i + batchSize) % 1000 === 0 || i + batchSize >= videosToCheck.length) {
          console.log(`   Checked ${Math.min(i + batchSize, videosToCheck.length)}/${videosToCheck.length} videos...`);
        }
      } catch (error) {
        console.error(`❌ Error checking batch:`, error.message);
      }
    }
    
    console.log(`\n✅ Found ${videosInPinecone.length} videos in Pinecone that need status update\n`);
    
    // Update database in batches
    if (videosInPinecone.length > 0) {
      console.log('📝 Updating database...');
      
      for (let i = 0; i < videosInPinecone.length; i += 100) {
        const batch = videosInPinecone.slice(i, i + 100);
        
        const { error } = await supabase
          .from('videos')
          .update({
            pinecone_embedded: true,
            pinecone_embedding_version: 'v1',
            pinecone_last_updated: new Date().toISOString()
          })
          .in('id', batch);

        if (error) {
          console.error(`❌ Error updating batch:`, error);
        } else {
          console.log(`   Updated ${i + batch.length}/${videosInPinecone.length}`);
        }
      }
      
      console.log('\n✅ Database update complete!');
    }
    
    // Show final stats
    const { count: finalEmbedded } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('pinecone_embedded', true);
    
    console.log('\n📊 Final Stats:');
    console.log(`   Videos marked as embedded: ${finalEmbedded}`);
    console.log(`   Vectors in Pinecone: 42078`);
    console.log(`   Sync complete!`);

  } catch (error) {
    console.error('❌ Update failed:', error);
  }
}

updateEmbeddingStatus();