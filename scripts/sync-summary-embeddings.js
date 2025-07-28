#!/usr/bin/env node

import { PineconeSummaryService } from '../lib/pinecone-summary-service.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('🔄 Summary Embedding Sync Tool\n');
  
  const service = new PineconeSummaryService();
  
  // Get stats first
  const { data: stats } = await supabase
    .from('llm_summary_status')
    .select('*')
    .single();
  
  if (stats) {
    console.log('📊 Current Status:');
    console.log(`  Total videos: ${stats.total_videos}`);
    console.log(`  Summaries generated: ${stats.summaries_generated}`);
    console.log(`  Embeddings synced: ${stats.embeddings_synced}`);
    console.log(`  Pending embeddings: ${stats.pending_embeddings}\n`);
  }
  
  if (stats?.pending_embeddings === 0) {
    console.log('✅ All embeddings are already synced!');
    return;
  }
  
  // Check for command line arguments
  const args = process.argv.slice(2);
  const batchSize = args[0] ? parseInt(args[0]) : 100;
  
  console.log(`Processing ${batchSize} embeddings...\n`);
  
  try {
    const result = await service.syncSummaryEmbeddings(batchSize);
    
    console.log('\n✅ Sync complete!');
    
    // Test search functionality
    if (result.successCount > 0) {
      console.log('\n🔍 Testing search functionality...');
      
      const testQuery = 'building custom furniture with hand tools';
      const results = await service.searchBySummary(testQuery, 5);
      
      console.log(`\nSearch results for: "${testQuery}"\n`);
      results.forEach((video, i) => {
        console.log(`${i + 1}. ${video.title}`);
        console.log(`   Channel: ${video.channel_name}`);
        console.log(`   Summary: ${video.llm_summary?.substring(0, 100)}...`);
        console.log(`   Score: ${video.similarity_score.toFixed(3)}\n`);
      });
    }
    
  } catch (error) {
    console.error('Error syncing embeddings:', error);
  }
}

main().catch(console.error);