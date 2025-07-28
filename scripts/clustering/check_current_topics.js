import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTopics() {
  console.log('Checking current topic assignments...\n');
  
  // Count videos with topics
  const { data: stats, error } = await supabase
    .from('videos')
    .select('topic_level_3', { count: 'exact' })
    .not('topic_level_3', 'is', null)
    .limit(1);
  
  console.log(`Videos with topic assignments: ${stats?.length ? stats[0].count : 0}`);
  
  // Get unique topic counts
  const { data: topics } = await supabase
    .rpc('get_unique_topic_counts');
  
  if (!topics && !error) {
    // Fallback query
    const { data: sampleTopics } = await supabase
      .from('videos')
      .select('topic_level_1, topic_level_2, topic_level_3')
      .not('topic_level_3', 'is', null)
      .limit(100);
    
    const uniqueL3 = new Set(sampleTopics?.map(v => v.topic_level_3));
    console.log(`\nUnique Level 3 topics (sample): ${uniqueL3.size}`);
    console.log('Topic IDs found:', Array.from(uniqueL3).slice(0, 10).join(', '), '...');
  }
  
  // Check if we have the mapping table
  const { data: mappingCheck } = await supabase
    .from('bertopic_clusters')
    .select('cluster_id, name')
    .limit(5);
  
  if (mappingCheck?.length > 0) {
    console.log('\n✅ Found bertopic_clusters table with mappings!');
    console.log('Sample clusters:');
    mappingCheck.forEach(c => {
      console.log(`  Cluster ${c.cluster_id}: ${c.name || 'No name yet'}`);
    });
  } else {
    console.log('\n❌ No bertopic_clusters table found - need to import cluster names');
  }
}

checkTopics().catch(console.error);