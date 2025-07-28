const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStatus() {
  console.log('Checking topic classification status...\n');
  
  // Count videos with topics
  const { count: withTopics } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('topic_level_1', 'is', null);
    
  // Count videos without topics
  const { count: withoutTopics } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('topic_level_1', null)
    .not('channel_id', 'is', null);
    
  // Count videos with embeddings
  const { count: withEmbeddings } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('pinecone_embedding_version', 3);
    
  // Count videos needing topics that have embeddings
  const { count: needTopicsWithEmbeddings } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('topic_level_1', null)
    .not('channel_id', 'is', null)
    .eq('pinecone_embedding_version', 3);
    
  console.log(`📊 Topic Classification Status:`);
  console.log(`   ✅ Videos with topics: ${withTopics}`);
  console.log(`   ❌ Videos without topics: ${withoutTopics}`);
  console.log(`   🔢 Videos with embeddings: ${withEmbeddings}`);
  console.log(`   🎯 Videos needing topics (with embeddings): ${needTopicsWithEmbeddings}`);
}

checkStatus().catch(console.error);