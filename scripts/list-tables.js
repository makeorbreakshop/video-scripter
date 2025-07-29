import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function listTables() {
  // Try to query the videos table directly
  const { data, error } = await supabase
    .from('videos')
    .select('id, llm_summary, llm_summary_generated_at')
    .limit(1);
  
  if (error) {
    console.log('Error accessing videos table:', error.message);
  } else {
    console.log('✅ Videos table exists');
    console.log('Sample row:', data);
  }
  
  // Check what columns exist
  const { data: cols, error: colError } = await supabase
    .from('videos')
    .select('*')
    .limit(0);
  
  if (!colError) {
    console.log('\nColumns in videos table:');
    const sampleRow = { ...data?.[0] };
    Object.keys(sampleRow || {}).forEach(col => {
      console.log(`  - ${col}`);
    });
  }
}

listTables().catch(console.error);