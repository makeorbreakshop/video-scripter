import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAndSetup() {
  console.log('Checking LLM summary embedding setup...\n');
  
  // Check if llm_summary_embedding_generated_at column exists
  try {
    const { data, error } = await supabase
      .from('videos')
      .select('id, llm_summary_embedding_generated_at')
      .limit(1);
    
    if (error && error.message.includes('column')) {
      console.log('❌ Column llm_summary_embedding_generated_at does not exist');
      console.log('   Need to add it to the videos table');
      
      // Add the column
      const { error: alterError } = await supabase.rpc('exec_sql', {
        sql: `
          ALTER TABLE videos 
          ADD COLUMN IF NOT EXISTS llm_summary_embedding_generated_at timestamptz;
        `
      });
      
      if (alterError) {
        console.log('   Failed to add column:', alterError.message);
      } else {
        console.log('   ✅ Column added successfully');
      }
    } else {
      console.log('✅ Column llm_summary_embedding_generated_at exists');
    }
  } catch (e) {
    console.log('Error checking column:', e.message);
  }
  
  // Check worker_control entry
  const { data: control, error: controlError } = await supabase
    .from('worker_control')
    .select('*')
    .eq('worker_type', 'llm_summary_vectorization')
    .single();
  
  if (controlError || !control) {
    console.log('\n❌ No worker_control entry for llm_summary_vectorization');
    
    // Add the entry
    const { error: insertError } = await supabase
      .from('worker_control')
      .insert({
        worker_type: 'llm_summary_vectorization',
        is_enabled: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    
    if (insertError) {
      console.log('   Failed to add worker control:', insertError.message);
    } else {
      console.log('   ✅ Worker control entry added (disabled by default)');
    }
  } else {
    console.log(`\n✅ Worker control exists: ${control.is_enabled ? 'enabled' : 'disabled'}`);
  }
  
  // Check how many videos have LLM summaries
  const { count: summaryCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('llm_summary', 'is', null);
  
  // Check how many already have embeddings
  const { count: embeddingCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('llm_summary_embedding_generated_at', 'is', null);
  
  console.log(`\n📊 Summary Stats:`);
  console.log(`   - Videos with LLM summaries: ${summaryCount}`);
  console.log(`   - Videos with summary embeddings: ${embeddingCount}`);
  console.log(`   - Videos needing embeddings: ${summaryCount - embeddingCount}`);
}

checkAndSetup().catch(console.error);