import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLLMVectorizationStatus() {
  console.log('🔍 Checking LLM Summary Vectorization Status...\n');

  // Total videos with LLM summaries
  const { count: totalWithSummaries } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('llm_summary', 'is', null);

  console.log(`📊 Total videos with LLM summaries: ${totalWithSummaries}\n`);

  // Synced vs pending breakdown
  const { data: syncStatus } = await supabase
    .from('videos')
    .select('llm_summary_embedding_synced')
    .not('llm_summary', 'is', null);

  const syncedCount = syncStatus?.filter(v => v.llm_summary_embedding_synced === true).length || 0;
  const pendingCount = syncStatus?.filter(v => v.llm_summary_embedding_synced === false).length || 0;
  const nullCount = syncStatus?.filter(v => v.llm_summary_embedding_synced === null).length || 0;

  console.log('🔄 Sync Status Breakdown:');
  console.log(`✅ Synced (true): ${syncedCount}`);
  console.log(`⏳ Pending (false): ${pendingCount}`);
  console.log(`❓ Not set (null): ${nullCount}`);
  console.log(`Total: ${syncedCount + pendingCount + nullCount}\n`);

  // Recent syncs
  const { data: recentSyncs } = await supabase
    .from('videos')
    .select('id, title, channel_name, llm_summary_embedding_synced, published_at')
    .not('llm_summary', 'is', null)
    .eq('llm_summary_embedding_synced', true)
    .order('id', { ascending: false })
    .limit(10);

  if (recentSyncs && recentSyncs.length > 0) {
    console.log('📌 10 Most Recent Synced Videos:');
    recentSyncs.forEach(video => {
      const title = video.title ? video.title.substring(0, 60) : 'Untitled';
      const channel = video.channel_name ? video.channel_name.substring(0, 30) : 'Unknown';
      const date = video.published_at ? new Date(video.published_at).toLocaleDateString() : 'Unknown date';
      console.log(`  ID ${video.id}: ${title}... | ${channel} | ${date}`);
    });
  } else {
    console.log('❌ No synced videos found!');
  }

  // Calculate percentage
  if (totalWithSummaries > 0) {
    const syncPercentage = ((syncedCount / totalWithSummaries) * 100).toFixed(2);
    console.log(`\n📈 Sync Progress: ${syncPercentage}% complete`);
  }
}

checkLLMVectorizationStatus().catch(console.error);