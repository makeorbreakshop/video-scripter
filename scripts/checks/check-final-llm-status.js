import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFinalStatus() {
  console.log('🔍 Checking Final LLM Summary Status...\n');

  // Get total count of all videos
  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });

  // Get count of videos WITH summaries
  const { count: withSummaries } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('llm_summary', 'is', null);

  // Get count of videos WITHOUT summaries
  const { count: withoutSummaries } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('llm_summary', null);

  console.log('📊 Final LLM Summary Status:');
  console.log(`✅ Total videos: ${totalVideos}`);
  console.log(`✅ Videos WITH summaries: ${withSummaries}`);
  console.log(`❌ Videos WITHOUT summaries: ${withoutSummaries}`);
  console.log(`📈 Completion rate: ${((withSummaries / totalVideos) * 100).toFixed(2)}%`);

  if (withoutSummaries > 0) {
    // Get a sample of videos still missing summaries
    const { data: missingSample } = await supabase
      .from('videos')
      .select('id, title, channel_name')
      .is('llm_summary', null)
      .limit(5);

    console.log('\n⚠️  Sample videos still missing summaries:');
    missingSample?.forEach(v => {
      console.log(`  - ${v.id}: ${v.title?.substring(0, 50)}... (${v.channel_name})`);
    });
  } else {
    console.log('\n🎉 All videos have LLM summaries!');
  }

  // Get timestamp range
  const { data: timeRange } = await supabase
    .from('videos')
    .select('llm_summary_generated_at')
    .not('llm_summary_generated_at', 'is', null)
    .order('llm_summary_generated_at', { ascending: true })
    .limit(1);

  const { data: latestTime } = await supabase
    .from('videos')
    .select('llm_summary_generated_at')
    .not('llm_summary_generated_at', 'is', null)
    .order('llm_summary_generated_at', { ascending: false })
    .limit(1);

  if (timeRange?.[0] && latestTime?.[0]) {
    console.log('\n⏰ Processing timeframe:');
    console.log(`  First: ${new Date(timeRange[0].llm_summary_generated_at).toLocaleString()}`);
    console.log(`  Latest: ${new Date(latestTime[0].llm_summary_generated_at).toLocaleString()}`);
  }
}

checkFinalStatus().catch(console.error);