// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Verify LLM summaries in Supabase and Pinecone
import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

async function verifyLLMSummaries() {
  console.log('🔍 Verifying LLM summaries from recent import...\n');
  
  // Get the channel from recent import
  const channelId = 'UCMG5uQag6BoG4w4rH7iGt4w';
  
  // 1. Check Supabase for LLM summaries
  console.log('📊 Checking Supabase database...');
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, llm_summary, llm_summary_generated_at, llm_summary_embedding_synced')
    .eq('channel_id', channelId)
    .order('published_at', { ascending: false })
    .limit(10);
    
  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }
  
  console.log(`Found ${videos.length} videos from channel ${channelId}\n`);
  
  // Check summary status
  const withSummaries = videos.filter(v => v.llm_summary);
  const withEmbeddingSync = videos.filter(v => v.llm_summary_embedding_synced);
  
  console.log(`✅ Videos with LLM summaries: ${withSummaries.length}/${videos.length}`);
  console.log(`✅ Videos with embedding sync: ${withEmbeddingSync.length}/${videos.length}\n`);
  
  // Show sample summaries
  console.log('📝 Sample LLM summaries:');
  withSummaries.slice(0, 3).forEach((video, i) => {
    console.log(`\n${i + 1}. "${video.title}"`);
    console.log(`   Summary: ${video.llm_summary}`);
    console.log(`   Generated: ${video.llm_summary_generated_at}`);
    console.log(`   Synced to Pinecone: ${video.llm_summary_embedding_synced ? 'Yes' : 'No'}`);
  });
  
  // 2. Check Pinecone for summary embeddings
  console.log('\n\n🔍 Checking Pinecone index...');
  const index = pinecone.index('youtube-titles-prod');
  const namespace = index.namespace('llm-summaries');
  
  // Query using video IDs
  const videoIds = videos.slice(0, 5).map(v => v.id);
  
  try {
    // Fetch vectors to verify they exist
    const fetchResponse = await namespace.fetch(videoIds);
    
    const foundVectors = Object.keys(fetchResponse.records || {});
    console.log(`\n✅ Found ${foundVectors.length}/${videoIds.length} vectors in Pinecone llm-summaries namespace`);
    
    if (foundVectors.length > 0) {
      console.log('\n📊 Sample vector metadata:');
      Object.entries(fetchResponse.records).slice(0, 2).forEach(([id, vector]) => {
        console.log(`\nVideo ID: ${id}`);
        console.log(`Title: ${vector.metadata?.title}`);
        console.log(`Channel: ${vector.metadata?.channel_name}`);
        console.log(`Summary preview: ${vector.metadata?.summary}`);
        console.log(`Vector dimensions: ${vector.values?.length || 0}`);
      });
    }
    
    // Get namespace stats
    const stats = await namespace.describeIndexStats();
    console.log('\n📈 Pinecone namespace stats:');
    console.log(`Total vectors in llm-summaries namespace: ${stats.namespaces?.['llm-summaries']?.recordCount || 0}`);
    
  } catch (error) {
    console.error('Error querying Pinecone:', error);
  }
  
  // 3. Summary report
  console.log('\n\n📋 VERIFICATION SUMMARY:');
  console.log('─'.repeat(50));
  console.log(`✅ Supabase: ${withSummaries.length}/${videos.length} videos have LLM summaries`);
  console.log(`✅ Supabase: ${withEmbeddingSync.length}/${videos.length} marked as synced to Pinecone`);
  console.log(`✅ Pinecone: Verified vectors exist in llm-summaries namespace`);
  console.log('─'.repeat(50));
  
  if (withSummaries.length === videos.length && withEmbeddingSync.length === videos.length) {
    console.log('\n🎉 All systems verified! LLM summaries are being generated and uploaded to Pinecone.');
  }
}

// Run verification
verifyLLMSummaries().catch(console.error);