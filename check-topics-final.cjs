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
    
  // Count videos without topics but with embeddings
  const { count: needTopics } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('topic_level_1', null)
    .not('channel_id', 'is', null)
    .eq('pinecone_embedding_version', 'v1');
    
  // Sample videos needing topics
  const { data: sampleVideos } = await supabase
    .from('videos')
    .select('id, title, channel_name')
    .is('topic_level_1', null)
    .not('channel_id', 'is', null)
    .eq('pinecone_embedding_version', 'v1')
    .limit(5);
    
  console.log(`📊 Topic Classification Status:`);
  console.log(`   ✅ Videos with topics: ${withTopics?.toLocaleString()}`);
  console.log(`   🎯 Videos needing topics (with embeddings): ${needTopics?.toLocaleString()}`);
  
  if (sampleVideos && sampleVideos.length > 0) {
    console.log(`\n📹 Sample videos needing topics:`);
    sampleVideos.forEach(v => {
      console.log(`   - ${v.title?.substring(0, 60)}... (${v.channel_name})`);
    });
  }
}

checkStatus().catch(console.error);