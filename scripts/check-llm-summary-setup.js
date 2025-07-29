import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSetup() {
  console.log('🔍 Checking LLM Summary Vectorization Setup\n');
  
  // 1. Check Supabase column
  console.log('1️⃣ SUPABASE CHECK:');
  try {
    const { data, error } = await supabase
      .from('videos')
      .select('id, llm_summary_embedding_synced')
      .limit(1);
    
    if (error) {
      console.log('❌ Column llm_summary_embedding_synced not found:', error.message);
    } else {
      console.log('✅ Column llm_summary_embedding_synced exists');
      console.log('   Sample:', data?.[0]);
    }
    
    // Count videos ready for embedding
    const { count: summaryCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('llm_summary', 'is', null);
    
    const { count: embeddedCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('llm_summary_embedding_synced', true);
    
    console.log(`\n📊 Summary Stats:`);
    console.log(`   - Videos with LLM summaries: ${summaryCount?.toLocaleString()}`);
    console.log(`   - Videos with summary embeddings: ${embeddedCount || 0}`);
    console.log(`   - Videos needing embeddings: ${(summaryCount - (embeddedCount || 0)).toLocaleString()}`);
    
  } catch (e) {
    console.log('❌ Error checking Supabase:', e.message);
  }
  
  // 2. Check Pinecone
  console.log('\n2️⃣ PINECONE CHECK:');
  try {
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    
    const indexName = process.env.PINECONE_INDEX_NAME;
    console.log(`   Index: ${indexName}`);
    
    const index = pinecone.index(indexName);
    
    // Check default namespace (for titles)
    const defaultStats = await index.describeIndexStats();
    console.log(`\n   Default namespace:`);
    console.log(`   - Vectors: ${defaultStats.totalRecordCount?.toLocaleString() || 0}`);
    console.log(`   - Dimension: ${defaultStats.dimension || 'unknown'}`);
    
    // Check llm-summaries namespace
    const summaryNamespace = index.namespace('llm-summaries');
    const summaryStats = await summaryNamespace.describeIndexStats();
    
    console.log(`\n   llm-summaries namespace:`);
    console.log(`   - Vectors: ${summaryStats.totalRecordCount?.toLocaleString() || 0}`);
    
    // List all namespaces
    if (defaultStats.namespaces) {
      console.log(`\n   All namespaces:`);
      Object.entries(defaultStats.namespaces).forEach(([name, stats]) => {
        console.log(`   - ${name}: ${stats.recordCount} vectors`);
      });
    }
    
  } catch (e) {
    console.log('❌ Error checking Pinecone:', e.message);
  }
  
  // 3. Check worker control
  console.log('\n3️⃣ WORKER CONTROL CHECK:');
  const { data: control } = await supabase
    .from('worker_control')
    .select('*')
    .eq('worker_type', 'llm_summary_vectorization')
    .single();
  
  if (control) {
    console.log(`✅ Worker control exists: ${control.is_enabled ? 'ENABLED' : 'DISABLED'}`);
  } else {
    console.log('❌ No worker control entry found');
  }
  
  console.log('\n✅ Setup check complete!');
}

checkSetup().catch(console.error);