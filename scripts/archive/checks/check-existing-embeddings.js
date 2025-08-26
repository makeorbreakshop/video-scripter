#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkEmbeddings() {
  console.log('🔍 Checking for existing embeddings...\n');

  // Check Pinecone
  try {
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY
    });

    const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const thumbIndex = pinecone.index(process.env.PINECONE_THUMBNAIL_INDEX_NAME);

    const titleStats = await titleIndex.describeIndexStats();
    const thumbStats = await thumbIndex.describeIndexStats();

    console.log('📌 Pinecone Stats:');
    console.log(`- Title embeddings: ${titleStats.totalRecordCount?.toLocaleString() || 0}`);
    console.log(`- Thumbnail embeddings: ${thumbStats.totalRecordCount?.toLocaleString() || 0}`);

    // Get some sample IDs
    if (titleStats.totalRecordCount > 0 && thumbStats.totalRecordCount > 0) {
      // Query for some vectors
      const titleQuery = await titleIndex.query({
        vector: new Array(512).fill(0), // dummy vector
        topK: 100,
        includeMetadata: true
      });

      const thumbQuery = await thumbIndex.query({
        vector: new Array(768).fill(0), // dummy vector for CLIP
        topK: 100,
        includeMetadata: true
      });

      // Find videos with both
      const titleIds = new Set(titleQuery.matches.map(m => m.id));
      const thumbIds = new Set(thumbQuery.matches.map(m => m.id));
      const bothIds = [...titleIds].filter(id => thumbIds.has(id));

      console.log(`\n✅ Videos with BOTH embeddings: ${bothIds.length}`);

      if (bothIds.length > 0) {
        // Get video details
        const { data: videos } = await supabase
          .from('videos')
          .select('id, title, channel_title')
          .in('id', bothIds.slice(0, 5));

        console.log('\nSample videos with both embeddings:');
        videos?.forEach(v => console.log(`- ${v.title} (${v.channel_title})`));

        console.log('\n🎯 We have enough data to test multimodal embeddings!');
        return { titleIds: [...titleIds], thumbIds: [...thumbIds], bothIds };
      }
    }
  } catch (error) {
    console.error('Pinecone error:', error.message);
  }

  // Check local database as fallback
  const { data: localVids } = await supabase
    .from('videos')
    .select('id, title')
    .not('title_embedding', 'is', null)
    .limit(10);

  console.log(`\nLocal DB embeddings: ${localVids?.length || 0}`);
  
  return null;
}

checkEmbeddings();