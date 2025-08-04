const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkIndexes() {
  console.log('Checking indexes on videos table...\n');
  
  // Method 1: Check pg_indexes
  const { data: indexData, error: indexError } = await supabase
    .rpc('execute_sql', {
      sql: `
        SELECT schemaname, tablename, indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'videos'
        ORDER BY indexname;
      `
    });
    
  if (!indexError && indexData) {
    console.log('Current indexes on videos table:');
    indexData.forEach(idx => {
      console.log(`\n- ${idx.indexname}`);
      console.log(`  Definition: ${idx.indexdef}`);
    });
  }
  
  // Method 2: Analyze specific query
  console.log('\n\nQuery execution plan for our problematic query:');
  const { data: explainData, error: explainError } = await supabase
    .rpc('execute_sql', {
      sql: `
        EXPLAIN (ANALYZE, BUFFERS)
        SELECT id, title FROM videos 
        WHERE pinecone_embedded = true 
        AND llm_summary_embedding_synced = true
        LIMIT 1000;
      `
    });
    
  if (!explainError && explainData) {
    console.log(explainData);
  }
  
  // Method 3: Check table statistics
  console.log('\n\nTable statistics:');
  const { data: statsData, error: statsError } = await supabase
    .rpc('execute_sql', {
      sql: `
        SELECT 
          n_live_tup as live_rows,
          n_dead_tup as dead_rows,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          last_vacuum,
          last_autovacuum
        FROM pg_stat_user_tables
        WHERE relname = 'videos';
      `
    });
    
  if (!statsError && statsData) {
    console.log(statsData[0]);
  }
  
  process.exit(0);
}

checkIndexes().catch(console.error);