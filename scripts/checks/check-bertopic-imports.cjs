require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRecentImports() {
  // Check videos imported in last 7 days
  const { data, error } = await supabase
    .from('videos')
    .select('id, title, import_date, topic_cluster_id, topic_domain, topic_niche, topic_micro, bertopic_version')
    .gte('import_date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('import_date', { ascending: false })
    .limit(10);
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Recent imports (last 7 days):');
  console.log('Total found:', data?.length || 0);
  
  if (data?.length > 0) {
    console.log('\nSample videos:');
    data.forEach(v => {
      console.log(`\n- ${v.title.substring(0, 60)}...`);
      console.log(`  Import: ${new Date(v.import_date).toLocaleDateString()}`);
      console.log(`  BERTopic version: ${v.bertopic_version || 'none'}`);
      console.log(`  Cluster ID: ${v.topic_cluster_id || 'none'}`);
      console.log(`  Domain: ${v.topic_domain || 'none'}`);
      console.log(`  Niche: ${v.topic_niche || 'none'}`);
      console.log(`  Micro: ${v.topic_micro || 'none'}`);
    });
  }
  
  // Also check if bertopic_clusters table exists
  const { data: clusters, error: clusterError } = await supabase
    .from('bertopic_clusters')
    .select('cluster_id')
    .limit(1);
    
  console.log('\n\nBERTopic clusters table check:');
  if (clusterError) {
    console.log('Error or table not found:', clusterError.message);
  } else {
    console.log('Table exists and accessible');
  }
}

checkRecentImports();