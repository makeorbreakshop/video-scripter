import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTopics() {
  // Check topic distribution
  const { data, error } = await supabase
    .from('videos')
    .select('topic_cluster_id')
    .not('topic_cluster_id', 'is', null);
    
  const topicCounts = {};
  data.forEach(v => {
    topicCounts[v.topic_cluster_id] = (topicCounts[v.topic_cluster_id] || 0) + 1;
  });
  
  console.log('Topic distribution:');
  console.log('Topic -1 (outliers):', topicCounts[-1] || 0);
  console.log('Topics 0-215:', Object.keys(topicCounts).filter(t => t >= 0 && t <= 215).length);
  console.log('Topics > 215:', Object.keys(topicCounts).filter(t => t > 215).length);
  console.log('Total videos with topics:', data.length);
  
  // Show all unique topic IDs
  const sortedTopics = Object.keys(topicCounts).map(Number).sort((a, b) => a - b);
  console.log('\nAll unique topic IDs:', sortedTopics);
  
  // Check a few videos to see their classification
  const { data: sample } = await supabase
    .from('videos')
    .select('id, title, topic_cluster_id, topic_domain, topic_niche, topic_micro, bertopic_version')
    .limit(10);
    
  console.log('\nSample videos:');
  sample.forEach(v => {
    console.log(`\n- ${v.title.substring(0, 60)}...`);
    console.log(`  cluster_id: ${v.topic_cluster_id}, domain: ${v.topic_domain}, niche: ${v.topic_niche}, micro: ${v.topic_micro}`);
    console.log(`  version: ${v.bertopic_version}`);
  });
  
  // Check how many have the August 1st classification
  const { count: augustCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('bertopic_version', 'v1_2025-08-01');
    
  console.log(`\nVideos with August 1st BERTopic: ${augustCount}`);
}

checkTopics().catch(console.error);