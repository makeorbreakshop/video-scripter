import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function updateDatabaseHierarchy() {
  console.log('Loading new hierarchy mapping...');
  
  // Load the new hierarchy
  const newMapping = JSON.parse(
    await fs.readFile('./data/bertopic/better_topic_names_v3_proper_hierarchy.json', 'utf-8')
  );
  
  console.log('Fetching videos to update...');
  
  // Get all videos with BERTopic classifications
  let allVideos = [];
  let offset = 0;
  const batchSize = 1000;
  
  while (true) {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, topic_cluster_id')
      .eq('bertopic_version', 'v1_2025-08-01')
      .not('topic_cluster_id', 'is', null)
      .gte('topic_cluster_id', -1)  // Include outliers
      .range(offset, offset + batchSize - 1);
      
    if (error) {
      console.error('Error fetching videos:', error);
      return;
    }
    
    if (!videos || videos.length === 0) break;
    
    allVideos = allVideos.concat(videos);
    offset += batchSize;
    console.log(`Fetched ${allVideos.length} videos...`);
    
    if (videos.length < batchSize) break;
  }
  
  console.log(`Total videos to update: ${allVideos.length}`);
  
  // Prepare updates
  const updates = [];
  let outlierCount = 0;
  let mappedCount = 0;
  
  for (const video of allVideos) {
    const clusterId = video.topic_cluster_id;
    
    if (clusterId === -1) {
      // Outlier
      updates.push({
        id: video.id,
        topic_domain: 'Outlier',
        topic_niche: 'Outlier',
        topic_micro: 'Outlier'
      });
      outlierCount++;
    } else if (newMapping.topics[clusterId]) {
      // Mapped topic
      const topic = newMapping.topics[clusterId];
      updates.push({
        id: video.id,
        topic_domain: topic.category,
        topic_niche: topic.subcategory,
        topic_micro: topic.name
      });
      mappedCount++;
    }
  }
  
  console.log(`\nPrepared updates:`);
  console.log(`- Mapped topics: ${mappedCount}`);
  console.log(`- Outliers: ${outlierCount}`);
  console.log(`- Total: ${updates.length}`);
  
  // Update in batches
  console.log('\nUpdating database...');
  const updateBatchSize = 500;
  
  for (let i = 0; i < updates.length; i += updateBatchSize) {
    const batch = updates.slice(i, i + updateBatchSize);
    
    // Update each video in the batch
    for (const update of batch) {
      const { error } = await supabase
        .from('videos')
        .update({
          topic_domain: update.topic_domain,
          topic_niche: update.topic_niche,
          topic_micro: update.topic_micro
        })
        .eq('id', update.id);
        
      if (error) {
        console.error(`Error updating video ${update.id}:`, error);
      }
    }
    
    console.log(`Updated ${Math.min(i + updateBatchSize, updates.length)}/${updates.length} videos`);
  }
  
  console.log('\nDatabase update complete!');
  console.log('\nNOTE: You will need to refresh the materialized view to see the changes in the topic hierarchy.');
}

updateDatabaseHierarchy().catch(console.error);