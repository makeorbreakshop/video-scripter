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

async function quickCheck() {
  console.log('🔍 Quick Pinecone-Database Check\n');

  try {
    // Get Pinecone stats
    const indexName = process.env.PINECONE_INDEX_NAME || 'youtube-search';
    const index = pinecone.index(indexName);
    const stats = await index.describeIndexStats();
    
    console.log('📊 Pinecone Stats:');
    console.log(`   Index: ${indexName}`);
    console.log(`   Total vectors: ${stats.totalRecordCount || 0}\n`);

    // Get database stats
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('title', 'is', null);
      
    const { count: embeddedVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('pinecone_embedded', true);
    
    console.log('💾 Database Stats:');
    console.log(`   Total videos with titles: ${totalVideos}`);
    console.log(`   Videos marked as embedded: ${embeddedVideos}`);
    console.log(`   Videos not marked as embedded: ${totalVideos - embeddedVideos}\n`);
    
    console.log('📈 Summary:');
    console.log(`   Vectors in Pinecone: ${stats.totalRecordCount}`);
    console.log(`   Videos marked as embedded: ${embeddedVideos}`);
    console.log(`   Difference: ${stats.totalRecordCount - embeddedVideos} videos need status update`);
    
    // Sample check - get 10 random videos from Pinecone
    console.log('\n🎲 Sampling 10 videos from database to check Pinecone...');
    const { data: sampleVideos } = await supabase
      .from('videos')
      .select('id, title, pinecone_embedded')
      .not('title', 'is', null)
      .limit(10)
      .order('random()');
    
    if (sampleVideos) {
      const ids = sampleVideos.map(v => v.id);
      const pineconeCheck = await index.fetch(ids);
      
      console.log('Sample results:');
      for (const video of sampleVideos) {
        const inPinecone = pineconeCheck.records && pineconeCheck.records[video.id];
        console.log(`   ${video.id}: DB=${video.pinecone_embedded ? '✓' : '✗'}, Pinecone=${inPinecone ? '✓' : '✗'}`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

quickCheck();