const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeIOPSIssue() {
  console.log('=== IOPS Analysis ===\n');
  
  // 1. Count videos with our filter conditions
  console.log('1. Checking data distribution...');
  
  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
    
  const { count: embeddedVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('pinecone_embedded', true);
    
  const { count: bothEmbeddings } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('pinecone_embedded', true)
    .eq('llm_summary_embedding_synced', true);
    
  console.log(`Total videos: ${totalVideos?.toLocaleString()}`);
  console.log(`Videos with title embeddings: ${embeddedVideos?.toLocaleString()}`);
  console.log(`Videos with both embeddings: ${bothEmbeddings?.toLocaleString()}`);
  
  // 2. Test small query to see execution
  console.log('\n2. Testing small query (10 rows)...');
  const startTime = Date.now();
  
  const { data: sample, error } = await supabase
    .from('videos')
    .select('id, title')
    .eq('pinecone_embedded', true)
    .eq('llm_summary_embedding_synced', true)
    .limit(10);
    
  const queryTime = Date.now() - startTime;
  console.log(`Query time: ${queryTime}ms`);
  console.log(`Rows returned: ${sample?.length || 0}`);
  
  if (error) {
    console.error('Query error:', error);
  }
  
  // 3. Calculate estimated IOPS
  console.log('\n3. IOPS Estimation:');
  console.log('\nThe problem: Each PostgreSQL page read = 1 IOP');
  console.log('- PostgreSQL reads data in 8KB pages');
  console.log('- Without proper indexes, it may scan thousands of pages');
  console.log('- Your query filters on boolean columns which likely lack indexes');
  
  // 4. Recommendations
  console.log('\n4. Recommendations to reduce IOPS:');
  console.log('\na) Create composite index:');
  console.log(`CREATE INDEX idx_videos_embeddings 
  ON videos(pinecone_embedded, llm_summary_embedding_synced) 
  WHERE pinecone_embedded = true AND llm_summary_embedding_synced = true;`);
  
  console.log('\nb) Alternative approach - use materialized view:');
  console.log(`CREATE MATERIALIZED VIEW videos_with_embeddings AS
  SELECT id, title, metadata, topic_confidence
  FROM videos
  WHERE pinecone_embedded = true 
  AND llm_summary_embedding_synced = true;`);
  
  console.log('\nc) Or fetch IDs first, then batch fetch details:');
  console.log('- First query: SELECT id WHERE conditions (smaller result)');
  console.log('- Then: SELECT * WHERE id IN (batch_of_ids)');
  
  process.exit(0);
}

analyzeIOPSIssue().catch(console.error);