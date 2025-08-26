const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runQueries() {
  console.log('Running video count queries...\n');

  try {
    // Query 1: Total videos
    const { count: totalCount, error: error1 } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    if (error1) throw error1;
    console.log('1. Total videos:', totalCount);

    // Query 2: Videos with llm_summary
    const { count: withSummaryCount, error: error2 } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('llm_summary', 'is', null);
    
    if (error2) throw error2;
    console.log('2. Videos with llm_summary:', withSummaryCount);

    // Query 3: Videos without llm_summary
    const { count: withoutSummaryCount, error: error3 } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary', null);
    
    if (error3) throw error3;
    console.log('3. Videos without llm_summary:', withoutSummaryCount);

    // Query 4: Videos without llm_summary but with description >= 50 chars
    // Since Supabase doesn't support LENGTH in filters directly, we need to fetch and filter
    const { data: noSummaryWithDesc, error: error4 } = await supabase
      .from('videos')
      .select('description')
      .is('llm_summary', null)
      .not('description', 'is', null);

    if (error4) throw error4;
    
    const eligibleCount = noSummaryWithDesc ? 
      noSummaryWithDesc.filter(v => v.description && v.description.length >= 50).length : 0;

    console.log('4. Videos without llm_summary but with description >= 50 chars:', eligibleCount);

  } catch (error) {
    console.error('Error running queries:', error);
  }

  process.exit(0);
}

runQueries();