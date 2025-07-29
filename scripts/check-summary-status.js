import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSummaryStatus() {
  console.log('📊 Checking LLM Summary Status...\n');
  
  // Total videos
  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
    
  // Videos with summaries
  const { count: withSummaries } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('llm_summary', 'is', null);
    
  // Videos needing summaries (with valid descriptions)
  // Note: Can't use char_length in filter, need to check differently
  const { data: needingSummariesData } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT COUNT(*) as count
      FROM videos
      WHERE llm_summary IS NULL
      AND description IS NOT NULL
      AND LENGTH(description) >= 50
      AND channel_title != 'Make or Break Shop'
    `
  });
  const needingSummaries = needingSummariesData?.[0]?.count || 0;
    
  // Videos that can't be summarize (no/short description)
  const { data: cantSummarizeData } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT COUNT(*) as count
      FROM videos
      WHERE llm_summary IS NULL
      AND (description IS NULL OR LENGTH(description) < 50)
    `
  });
  const cantSummarize = cantSummarizeData?.[0]?.count || 0;
    
  console.log(`Total videos: ${totalVideos?.toLocaleString()}`);
  console.log(`With summaries: ${withSummaries?.toLocaleString()} (${((withSummaries/totalVideos)*100).toFixed(1)}%)`);
  console.log(`Need summaries: ${needingSummaries?.toLocaleString()} (${((needingSummaries/totalVideos)*100).toFixed(1)}%)`);
  console.log(`Can't summarize: ${cantSummarize?.toLocaleString()} (${((cantSummarize/totalVideos)*100).toFixed(1)}%)`);
  
  // Check for duplicates in videos table
  const { data: duplicateCheck } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT id, COUNT(*) as count 
      FROM videos 
      GROUP BY id 
      HAVING COUNT(*) > 1 
      LIMIT 10
    `
  });
  
  if (duplicateCheck && duplicateCheck.length > 0) {
    console.log('\n⚠️  Found duplicate video IDs in database!');
    console.log(`First few duplicates:`, duplicateCheck);
  } else {
    console.log('\n✅ No duplicate video IDs in database');
  }
}

checkSummaryStatus().catch(console.error);