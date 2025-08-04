import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkMapping() {
  // Check how many unique micro-topics exist per niche
  const { data, error } = await supabase
    .from('topic_distribution_stats')
    .select('domain, niche, micro_topic, topic_cluster_id')
    .order('domain, niche, micro_topic');
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  // Group by domain and niche to see micro-topic distribution
  const mapping = {};
  data.forEach(row => {
    if (!mapping[row.domain]) mapping[row.domain] = {};
    if (!mapping[row.domain][row.niche]) mapping[row.domain][row.niche] = new Set();
    mapping[row.domain][row.niche].add(row.micro_topic);
  });
  
  // Find niches with multiple micro-topics
  console.log('Niches with multiple micro-topics:');
  console.log('===================================');
  let multiMicroCount = 0;
  let singleMicroCount = 0;
  
  Object.entries(mapping).forEach(([domain, niches]) => {
    Object.entries(niches).forEach(([niche, microTopics]) => {
      if (microTopics.size > 1) {
        multiMicroCount++;
        console.log(`${domain} > ${niche}: ${microTopics.size} micro-topics`);
        Array.from(microTopics).forEach(micro => {
          console.log(`  - ${micro}`);
        });
      } else {
        singleMicroCount++;
      }
    });
  });
  
  console.log(`\nSummary:`);
  console.log(`Niches with 1 micro-topic: ${singleMicroCount}`);
  console.log(`Niches with >1 micro-topics: ${multiMicroCount}`);
  
  // Check the original cluster assignments
  console.log('\n\nChecking original BERTopic assignments:');
  const { data: videos } = await supabase
    .from('videos')
    .select('topic_domain, topic_niche, topic_micro, topic_cluster_id')
    .eq('bertopic_version', 'v1_2025-08-01')
    .gte('topic_cluster_id', 0)
    .limit(1000);
    
  const clusterMapping = {};
  videos?.forEach(v => {
    const key = `${v.topic_domain}|${v.topic_niche}`;
    if (!clusterMapping[key]) clusterMapping[key] = new Set();
    clusterMapping[key].add(`${v.topic_micro}|${v.topic_cluster_id}`);
  });
  
  // Show some examples of niches with multiple clusters
  console.log('\nExamples of domain>niche combinations with multiple clusters:');
  Object.entries(clusterMapping).forEach(([key, clusters]) => {
    if (clusters.size > 1) {
      const [domain, niche] = key.split('|');
      console.log(`\n${domain} > ${niche}:`);
      Array.from(clusters).forEach(cluster => {
        const [micro, id] = cluster.split('|');
        console.log(`  Cluster ${id}: ${micro}`);
      });
    }
  });
}

checkMapping().catch(console.error);