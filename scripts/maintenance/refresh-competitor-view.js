import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function refreshCompetitorView() {
  console.log('🔄 Refreshing competitor channel summary materialized view...');
  
  const { error } = await supabase.rpc('refresh_competitor_channel_summary');
  
  if (error) {
    console.error('❌ Error refreshing view:', error);
    return;
  }
  
  console.log('✅ Competitor channel summary refreshed successfully!');
  
  // Show a sample of the updated data
  console.log('\n📊 Sample of updated channels:');
  const { data: sample, error: sampleError } = await supabase
    .from('competitor_channel_summary')
    .select('channel_name, subscriber_count, channel_thumbnail')
    .gt('subscriber_count', 0)
    .not('channel_thumbnail', 'is', null)
    .limit(5);
  
  if (!sampleError && sample) {
    sample.forEach(channel => {
      console.log(`- ${channel.channel_name}: ${channel.subscriber_count.toLocaleString()} subscribers`);
      console.log(`  Thumbnail: ${channel.channel_thumbnail ? '✅' : '❌'}`);
    });
  }
}

refreshCompetitorView();