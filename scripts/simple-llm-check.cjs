const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  try {
    // Get videos with LLM summaries from July 28
    const { data, error, count } = await supabase
      .from('videos')
      .select('id, title, channel_name, llm_summary, llm_summary_generated_at, llm_summary_model', { count: 'exact' })
      .gte('llm_summary_generated_at', '2025-07-28T00:00:00')
      .lt('llm_summary_generated_at', '2025-07-29T00:00:00')
      .limit(10);

    if (error) {
      console.error('Error:', error);
      return;
    }

    console.log(`Total videos with LLM summaries from July 28: ${count}`);
    console.log('\nSample videos:');
    console.log('='.repeat(80));

    data?.forEach((video, i) => {
      console.log(`\n${i + 1}. ${video.title}`);
      console.log(`   Channel: ${video.channel_name}`);
      console.log(`   Model: ${video.llm_summary_model || 'N/A'}`);
      console.log(`   Generated: ${new Date(video.llm_summary_generated_at).toLocaleString()}`);
      console.log(`   Summary: ${video.llm_summary?.substring(0, 150)}...`);
    });

    // Get total count of videos with summaries
    const { count: totalCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('llm_summary', 'is', null);

    console.log(`\n\nTotal videos with LLM summaries in database: ${totalCount}`);

  } catch (err) {
    console.error('Script error:', err);
  }
}

main();