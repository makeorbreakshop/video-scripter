import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStatus() {
  console.log('📊 Checking LLM Summary Status...\n');
  
  // Count videos with llm_summary
  const { count: withSummary } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('llm_summary', 'is', null);
    
  console.log(`Videos WITH llm_summary: ${withSummary?.toLocaleString()}`);
  
  // Count videos without llm_summary
  const { count: withoutSummary } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('llm_summary', null);
    
  console.log(`Videos WITHOUT llm_summary: ${withoutSummary?.toLocaleString()}`);
  
  // Count videos eligible for summary (no summary, has description >= 50 chars)
  const { count: eligibleCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('llm_summary', null)
    .not('description', 'is', null)
    .neq('channel_name', 'Make or Break Shop');
    
  console.log(`\nVideos eligible for LLM summary: ${eligibleCount?.toLocaleString()}`);
  console.log('(no summary, has description, not Make or Break Shop)');
  
  // Sample some to see
  const { data: sample } = await supabase
    .from('videos')
    .select('id, title, channel_name, description')
    .is('llm_summary', null)
    .not('description', 'is', null)
    .neq('channel_name', 'Make or Break Shop')
    .limit(5);
    
  console.log('\nSample videos needing summaries:');
  sample?.forEach(v => {
    console.log(`- ${v.title} (${v.description?.length} chars)`);
  });
}

checkStatus().catch(console.error);