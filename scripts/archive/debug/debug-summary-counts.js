import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugSummaryCounts() {
  console.log('🔍 Debugging Summary Counts...\n');
  
  // Check different conditions
  const queries = [
    {
      name: "Total videos",
      sql: "SELECT COUNT(*) as count FROM videos"
    },
    {
      name: "Videos with llm_summary",
      sql: "SELECT COUNT(*) as count FROM videos WHERE llm_summary IS NOT NULL"
    },
    {
      name: "Videos without llm_summary",
      sql: "SELECT COUNT(*) as count FROM videos WHERE llm_summary IS NULL"
    },
    {
      name: "Videos with description",
      sql: "SELECT COUNT(*) as count FROM videos WHERE description IS NOT NULL"
    },
    {
      name: "Videos with description >= 50 chars",
      sql: "SELECT COUNT(*) as count FROM videos WHERE description IS NOT NULL AND LENGTH(description) >= 50"
    },
    {
      name: "Make or Break Shop videos",
      sql: "SELECT COUNT(*) as count FROM videos WHERE channel_title = 'Make or Break Shop'"
    },
    {
      name: "Videos eligible for summary (no summary, has desc >= 50, not MBS)",
      sql: `SELECT COUNT(*) as count FROM videos 
            WHERE llm_summary IS NULL 
            AND description IS NOT NULL 
            AND LENGTH(description) >= 50 
            AND (channel_title != 'Make or Break Shop' OR channel_title IS NULL)`
    }
  ];
  
  for (const query of queries) {
    const { data, error } = await supabase.rpc('exec_sql', { sql: query.sql });
    if (error) {
      console.error(`Error with "${query.name}":`, error);
    } else {
      console.log(`${query.name}: ${data?.[0]?.count?.toLocaleString() || 0}`);
    }
  }
  
  // Check some sample videos without summaries
  console.log('\n📋 Sample videos without summaries:');
  const { data: samples } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT id, title, channel_title, 
             LENGTH(description) as desc_length,
             llm_summary IS NOT NULL as has_summary
      FROM videos 
      WHERE llm_summary IS NULL 
      AND description IS NOT NULL
      LIMIT 5
    `
  });
  
  if (samples && samples.length > 0) {
    samples.forEach(v => {
      console.log(`\n  ID: ${v.id}`);
      console.log(`  Title: ${v.title}`);
      console.log(`  Channel: ${v.channel_title}`);
      console.log(`  Description length: ${v.desc_length}`);
      console.log(`  Has summary: ${v.has_summary}`);
    });
  }
}

debugSummaryCounts().catch(console.error);