import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Load the new hierarchy
const newMapping = JSON.parse(
  await fs.readFile('./data/bertopic/better_topic_names_v3_proper_hierarchy.json', 'utf-8')
);

async function updateClusterInBatches(clusterId, domain, niche, micro) {
  const BATCH_SIZE = 100; // Update 100 videos at a time
  let offset = 0;
  let totalUpdated = 0;
  
  console.log(`Updating cluster ${clusterId}: ${domain} > ${niche} > ${micro}`);
  
  while (true) {
    // Get batch of video IDs
    const { data: videos, error: fetchError } = await supabase
      .from('videos')
      .select('id')
      .eq('topic_cluster_id', clusterId)
      .eq('bertopic_version', 'v1_2025-08-01')
      .range(offset, offset + BATCH_SIZE - 1);
      
    if (fetchError) {
      console.error(`Error fetching videos for cluster ${clusterId}:`, fetchError);
      break;
    }
    
    if (!videos || videos.length === 0) {
      break; // No more videos
    }
    
    // Update this batch
    const videoIds = videos.map(v => v.id);
    const { error: updateError, count } = await supabase
      .from('videos')
      .update({ 
        topic_domain: domain,
        topic_niche: niche,
        topic_micro: micro
      })
      .in('id', videoIds);
      
    if (updateError) {
      console.error(`Error updating batch for cluster ${clusterId}:`, updateError);
      break;
    }
    
    totalUpdated += count || videos.length;
    process.stdout.write(`\r  Updated ${totalUpdated} videos...`);
    
    if (videos.length < BATCH_SIZE) {
      break; // Last batch
    }
    
    offset += BATCH_SIZE;
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  console.log(`\r  ✓ Cluster ${clusterId}: ${totalUpdated} videos updated`);
  return totalUpdated;
}

async function updateAllClusters() {
  console.log('Starting paginated hierarchy update...\n');
  
  let totalVideosUpdated = 0;
  let clustersUpdated = 0;
  const startTime = Date.now();
  
  // Process regular clusters
  for (const [clusterId, topic] of Object.entries(newMapping.topics)) {
    const count = await updateClusterInBatches(
      parseInt(clusterId),
      topic.category,
      topic.subcategory,
      topic.name
    );
    
    totalVideosUpdated += count;
    clustersUpdated++;
    
    // Progress update
    if (clustersUpdated % 10 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`\nProgress: ${clustersUpdated}/216 clusters (${elapsed}s elapsed)\n`);
    }
  }
  
  // Handle outliers
  console.log('\nUpdating outliers...');
  const outlierCount = await updateClusterInBatches(-1, 'Outlier', 'Outlier', 'Outlier');
  totalVideosUpdated += outlierCount;
  
  const totalTime = Math.round((Date.now() - startTime) / 1000);
  
  console.log('\n=== Update Complete ===');
  console.log(`Total videos updated: ${totalVideosUpdated}`);
  console.log(`Total time: ${totalTime} seconds`);
  console.log('\nNow refresh the materialized view:');
  console.log('REFRESH MATERIALIZED VIEW topic_distribution_stats;');
}

updateAllClusters().catch(console.error);