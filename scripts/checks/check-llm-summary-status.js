import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStatus() {
  console.log('🔍 Checking LLM Summary Status...\n');

  // Get counts of different states
  const { count: nullSummaries } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('llm_summary', null);

  const { count: hasTimestamp } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('llm_summary_generated_at', 'is', null);

  const { count: hasSummary } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('llm_summary', 'is', null);

  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });

  console.log(`📊 Database Status:`);
  console.log(`Total videos: ${totalVideos}`);
  console.log(`Videos with summaries: ${hasSummary}`);
  console.log(`Videos without summaries: ${nullSummaries}`);
  console.log(`Videos with timestamp but maybe no summary: ${hasTimestamp}`);
  
  // Check for inconsistencies
  const { data: broken } = await supabase
    .from('videos')
    .select('id, title, llm_summary, llm_summary_generated_at')
    .is('llm_summary', null)
    .not('llm_summary_generated_at', 'is', null)
    .limit(5);

  if (broken && broken.length > 0) {
    console.log(`\n⚠️  Found ${broken.length} videos with timestamp but no summary:`);
    broken.forEach(v => {
      console.log(`  - ${v.id}: ${v.title?.substring(0, 50)}...`);
    });
  }

  // Get last processed video ID
  const { data: lastProcessed } = await supabase
    .from('videos')
    .select('id')
    .not('llm_summary', 'is', null)
    .order('id', { ascending: false })
    .limit(1);

  if (lastProcessed && lastProcessed[0]) {
    console.log(`\n📍 Last processed video ID: ${lastProcessed[0].id}`);
  }

  console.log(`\n✅ Videos actually needing summaries: ${nullSummaries}`);
}

checkStatus().catch(console.error);