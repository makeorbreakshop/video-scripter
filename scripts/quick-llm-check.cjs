const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  try {
    // First, just check if the columns exist
    const { data: sample, error: sampleError } = await supabase
      .from('videos')
      .select('id, llm_summary, llm_summary_generated_at')
      .limit(1);

    if (sampleError) {
      console.error('Column check error:', sampleError);
      return;
    }

    console.log('Columns exist. Checking for July 28 summaries...');

    // Get just a count first without selecting data
    const { count, error: countError } = await supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .not('llm_summary_generated_at', 'is', null)
      .gte('llm_summary_generated_at', '2025-07-28')
      .lt('llm_summary_generated_at', '2025-07-29');

    if (countError) {
      console.error('Count error:', countError);
    } else {
      console.log(`\nVideos with LLM summaries from July 28: ${count}`);
    }

    // Get a few samples
    const { data: samples, error: samplesError } = await supabase
      .from('videos')
      .select('title, llm_summary')
      .not('llm_summary', 'is', null)
      .limit(5);

    if (!samplesError && samples) {
      console.log('\nSample summaries (any date):');
      samples.forEach((v, i) => {
        console.log(`\n${i + 1}. ${v.title}`);
        console.log(`   Summary: ${v.llm_summary?.substring(0, 100)}...`);
      });
    }

    // Check date range of summaries
    const { data: dateRange } = await supabase
      .from('videos') 
      .select('llm_summary_generated_at')
      .not('llm_summary_generated_at', 'is', null)
      .order('llm_summary_generated_at', { ascending: false })
      .limit(1);

    if (dateRange && dateRange[0]) {
      console.log(`\nMost recent summary generated at: ${new Date(dateRange[0].llm_summary_generated_at).toLocaleString()}`);
    }

  } catch (err) {
    console.error('Script error:', err);
  }
}

main();