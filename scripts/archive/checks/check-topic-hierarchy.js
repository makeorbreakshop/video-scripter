import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkHierarchy() {
  // Check a sample of the data
  const { data, error } = await supabase
    .from('topic_distribution_stats')
    .select('domain, niche, micro_topic, topic_cluster_id, video_count')
    .order('video_count', { ascending: false })
    .limit(20);
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Sample topic hierarchy data:');
  console.log('=====================================');
  data.forEach(row => {
    console.log(`Cluster ${row.topic_cluster_id}:`);
    console.log(`  Domain: ${row.domain}`);
    console.log(`  Niche: ${row.niche}`);
    console.log(`  Micro: ${row.micro_topic}`);
    console.log(`  Videos: ${row.video_count}`);
    console.log('---');
  });
  
  // Check if niche and micro are the same
  const sameCount = data.filter(row => row.niche === row.micro_topic).length;
  console.log(`\nRows where Niche = Micro: ${sameCount}/${data.length}`);
  
  // Also check the raw videos table
  const { data: videos } = await supabase
    .from('videos')
    .select('topic_domain, topic_niche, topic_micro, topic_cluster_id')
    .eq('bertopic_version', 'v1_2025-08-01')
    .gte('topic_cluster_id', 0)
    .limit(10);
    
  console.log('\n\nSample from videos table:');
  console.log('========================');
  videos?.forEach(v => {
    console.log(`Cluster ${v.topic_cluster_id}: ${v.topic_domain} > ${v.topic_niche} > ${v.topic_micro}`);
  });
}

checkHierarchy().catch(console.error);