import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Check recent imports
const { data, error } = await supabase
  .from('videos')
  .select('id, title, llm_summary, llm_summary_generated_at, llm_summary_embedding_synced')
  .eq('channel_id', 'UCMG5uQag6BoG4w4rH7iGt4w')
  .gte('created_at', '2025-07-30')
  .order('created_at', { ascending: false })
  .limit(5);

console.log('Recent videos:', data?.length || 0);
data?.forEach(v => {
  console.log(`\n${v.title}`);
  console.log(`- Has summary: ${v.llm_summary ? 'Yes' : 'No'}`);
  console.log(`- Synced to Pinecone: ${v.llm_summary_embedding_synced ? 'Yes' : 'No'}`);
});

// Check total synced
const { count } = await supabase
  .from('videos')
  .select('*', { count: 'exact', head: true })
  .eq('llm_summary_embedding_synced', true);

console.log(`\nTotal videos synced to Pinecone: ${count || 0}`);