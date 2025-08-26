import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkLLMSummaries() {
  console.log('Checking LLM summaries from July 28, 2025...\n');

  // 1. Count videos with llm_summary_generated_at from July 28
  const { count, error: countError } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .gte('llm_summary_generated_at', '2025-07-28T00:00:00')
    .lt('llm_summary_generated_at', '2025-07-29T00:00:00');

  if (countError) {
    console.error('Error counting summaries:', countError);
    return;
  }

  console.log(`Total videos with LLM summaries from July 28: ${count}`);

  // 2. Get overall stats by checking total videos with summaries
  const { count: totalWithSummary, error: totalError } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('llm_summary', 'is', null);

  if (!totalError) {
    console.log('\nOverall LLM Summary Stats:');
    console.log('- Total videos with summaries:', totalWithSummary);
    console.log('- Summaries from July 28:', count);
  }

  // 3. Sample a few videos with llm_summary from July 28
  const { data: sampleData, error: sampleError } = await supabase
    .from('videos')
    .select('id, title, channel_title, llm_summary, llm_summary_generated_at')
    .gte('llm_summary_generated_at', '2025-07-28T00:00:00')
    .lt('llm_summary_generated_at', '2025-07-29T00:00:00')
    .not('llm_summary', 'is', null)
    .limit(5);

  if (!sampleError && sampleData) {
    console.log('\n\nSample videos with LLM summaries from July 28:');
    console.log('=' .repeat(80));
    
    sampleData.forEach((video, index) => {
      console.log(`\n${index + 1}. ${video.title}`);
      console.log(`   Channel: ${video.channel_title}`);
      console.log(`   Generated: ${new Date(video.llm_summary_generated_at).toLocaleString()}`);
      console.log(`   Summary: ${video.llm_summary?.substring(0, 200)}...`);
    });
  }

  // 4. Check pattern - group by channel
  const { data: channelData, error: channelError } = await supabase
    .from('videos')
    .select('channel_title')
    .gte('llm_summary_generated_at', '2025-07-28T00:00:00')
    .lt('llm_summary_generated_at', '2025-07-29T00:00:00');

  if (!channelError && channelData) {
    const channelCounts = {};
    channelData.forEach(video => {
      channelCounts[video.channel_title] = (channelCounts[video.channel_title] || 0) + 1;
    });

    console.log('\n\nVideos with July 28 summaries by channel:');
    console.log('=' .repeat(50));
    
    Object.entries(channelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([channel, count]) => {
        console.log(`${channel}: ${count} videos`);
      });
  }

  // 5. Check timestamp pattern
  const { data: timestampData, error: timestampError } = await supabase
    .from('videos')
    .select('llm_summary_generated_at')
    .gte('llm_summary_generated_at', '2025-07-28T00:00:00')
    .lt('llm_summary_generated_at', '2025-07-29T00:00:00')
    .order('llm_summary_generated_at', { ascending: true });

  if (!timestampError && timestampData && timestampData.length > 0) {
    console.log('\n\nTimestamp range for July 28 summaries:');
    console.log(`First: ${new Date(timestampData[0].llm_summary_generated_at).toLocaleString()}`);
    console.log(`Last: ${new Date(timestampData[timestampData.length - 1].llm_summary_generated_at).toLocaleString()}`);
    
    // Check if they were all generated in a batch
    const firstTime = new Date(timestampData[0].llm_summary_generated_at).getTime();
    const lastTime = new Date(timestampData[timestampData.length - 1].llm_summary_generated_at).getTime();
    const duration = (lastTime - firstTime) / 1000 / 60; // minutes
    
    console.log(`Duration: ${duration.toFixed(2)} minutes`);
    console.log(`Rate: ${(timestampData.length / duration * 60).toFixed(0)} summaries/hour`);
  }
}

checkLLMSummaries().catch(console.error);