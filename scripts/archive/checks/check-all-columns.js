import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkColumns() {
  // Get one full row to see all columns
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .limit(1);
  
  if (error) {
    console.log('Error:', error.message);
    return;
  }
  
  const columns = Object.keys(data[0] || {});
  console.log(`Videos table has ${columns.length} columns:\n`);
  
  // Check for specific columns we care about
  const importantColumns = [
    'llm_summary',
    'llm_summary_generated_at',
    'llm_summary_embedding_generated_at',
    'title_embedding',
    'title_embedding_generated_at',
    'pinecone_embedded',
    'thumbnail_embedding',
    'thumbnail_embedding_generated_at'
  ];
  
  importantColumns.forEach(col => {
    const exists = columns.includes(col);
    console.log(`${exists ? '✅' : '❌'} ${col}`);
  });
  
  console.log('\nAll columns:');
  columns.sort().forEach(col => console.log(`  - ${col}`));
}

checkColumns().catch(console.error);