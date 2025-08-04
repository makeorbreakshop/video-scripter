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

async function updateSingleCluster(clusterId, domain, niche, micro) {
  try {
    const startTime = Date.now();
    
    // Use raw SQL for efficiency
    const { data, error } = await supabase.rpc('execute_sql', {
      sql: `
        UPDATE videos 
        SET topic_domain = $1, topic_niche = $2, topic_micro = $3
        WHERE topic_cluster_id = $4 
        AND bertopic_version = 'v1_2025-08-01'
      `,
      params: [domain, niche, micro, clusterId]
    });
    
    if (error) {
      // If RPC doesn't exist, fall back to regular update
      const { error: updateError, count } = await supabase
        .from('videos')
        .update({ 
          topic_domain: domain,
          topic_niche: niche,
          topic_micro: micro
        })
        .eq('topic_cluster_id', clusterId)
        .eq('bertopic_version', 'v1_2025-08-01');
        
      if (updateError) {
        console.error(`❌ Cluster ${clusterId}: ${updateError.message}`);
        return 0;
      }
      
      const duration = Date.now() - startTime;
      console.log(`✓ Cluster ${clusterId}: ${count} videos updated (${duration}ms)`);
      return count || 0;
    }
    
    const duration = Date.now() - startTime;
    console.log(`✓ Cluster ${clusterId}: Updated (${duration}ms)`);
    return 1;
  } catch (err) {
    console.error(`❌ Cluster ${clusterId}: ${err.message}`);
    return 0;
  }
}

async function updateAllClusters() {
  console.log('Starting one-by-one cluster updates...\n');
  
  let totalUpdated = 0;
  let failedClusters = [];
  
  // Sort clusters by ID for consistent processing
  const clusters = Object.entries(newMapping.topics)
    .sort(([a], [b]) => parseInt(a) - parseInt(b));
  
  // Process each cluster
  for (const [clusterId, topic] of clusters) {
    const id = parseInt(clusterId);
    
    // Skip if already processed (for resuming)
    // You can check this by querying a sample video from the cluster
    
    const updated = await updateSingleCluster(
      id,
      topic.category,
      topic.subcategory,
      topic.name
    );
    
    if (updated === 0) {
      failedClusters.push(id);
    } else {
      totalUpdated++;
    }
    
    // Progress indicator every 10 clusters
    if ((totalUpdated + failedClusters.length) % 10 === 0) {
      console.log(`\nProgress: ${totalUpdated + failedClusters.length}/216 clusters processed\n`);
    }
    
    // Small delay between updates
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  // Handle outliers
  console.log('\nUpdating outliers...');
  const outlierUpdate = await updateSingleCluster(-1, 'Outlier', 'Outlier', 'Outlier');
  
  console.log('\n=== Summary ===');
  console.log(`Total clusters updated: ${totalUpdated}/216`);
  if (failedClusters.length > 0) {
    console.log(`Failed clusters: ${failedClusters.join(', ')}`);
    
    // Save failed clusters for retry
    await fs.writeFile(
      './failed_clusters.json',
      JSON.stringify(failedClusters, null, 2)
    );
    console.log('Failed clusters saved to failed_clusters.json');
  }
  
  console.log('\nDone! Remember to refresh the materialized view:');
  console.log('REFRESH MATERIALIZED VIEW topic_distribution_stats;');
}

// Check if we're resuming from failed clusters
try {
  const failed = JSON.parse(await fs.readFile('./failed_clusters.json', 'utf-8'));
  if (failed.length > 0) {
    console.log(`Found ${failed.length} failed clusters from previous run. Retry them? (y/n)`);
    // For now, just proceed with all clusters
  }
} catch (e) {
  // No failed clusters file, proceed normally
}

updateAllClusters().catch(console.error);