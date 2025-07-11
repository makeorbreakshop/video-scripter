#!/usr/bin/env node

/**
 * Calculate Cluster Centroids from Local Export Data
 * 
 * This script:
 * 1. Loads title embeddings from local exports/all-title-embeddings-from-db.json
 * 2. Gets topic assignments from database
 * 3. Calculates centroid embeddings for each cluster
 * 4. Populates the bertopic_clusters table with topic hierarchy and centroids
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs/promises';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Calculate the average of multiple embeddings (centroid)
 */
function calculateCentroid(embeddings) {
  if (embeddings.length === 0) return null;
  
  const dimension = embeddings[0].length;
  const centroid = new Array(dimension).fill(0);
  
  // Sum all embeddings
  for (const embedding of embeddings) {
    for (let i = 0; i < dimension; i++) {
      centroid[i] += embedding[i];
    }
  }
  
  // Average by dividing by count
  for (let i = 0; i < dimension; i++) {
    centroid[i] /= embeddings.length;
  }
  
  return centroid;
}

async function main() {
  console.log('🚀 Starting cluster centroid calculation from local exports...');
  
  try {
    // Step 1: Load title embeddings from local export
    console.log('📂 Loading title embeddings from local export...');
    
    const embeddingsData = JSON.parse(
      await fs.readFile('/Users/brandoncullum/video-scripter/exports/all-title-embeddings-from-db.json', 'utf-8')
    );
    
    console.log(`📊 Loaded ${embeddingsData.export_info.total_videos} title embeddings`);
    
    // Create lookup map: video_id -> embedding
    const embeddingLookup = new Map();
    embeddingsData.videos.forEach(video => {
      if (video.embedding && video.embedding.length === 512) {
        embeddingLookup.set(video.video_id, video.embedding);
      }
    });
    
    console.log(`📥 Built embedding lookup for ${embeddingLookup.size} videos`);

    // Step 2: Get topic assignments from database
    console.log('📊 Fetching topic assignments from database...');
    
    const { data: clusters, error: clustersError } = await supabase
      .from('videos')
      .select(`
        video_id,
        topic_level_1,
        topic_level_2, 
        topic_level_3
      `)
      .not('topic_level_1', 'is', null)
      .not('topic_level_2', 'is', null)
      .not('topic_level_3', 'is', null);
    
    if (clustersError) {
      throw new Error(`Failed to fetch topic clusters: ${clustersError.message}`);
    }
    
    console.log(`📈 Found ${clusters.length} videos with topic assignments`);
    
    // Step 3: Group videos by topic hierarchy
    const topicGroups = new Map();
    let videosWithEmbeddings = 0;
    
    for (const video of clusters) {
      // Only include videos that have embeddings
      if (!embeddingLookup.has(video.video_id)) {
        continue;
      }
      
      videosWithEmbeddings++;
      const key = `${video.topic_level_1}|${video.topic_level_2}|${video.topic_level_3}`;
      
      if (!topicGroups.has(key)) {
        topicGroups.set(key, {
          domain: video.topic_level_1,
          niche: video.topic_level_2,
          micro: video.topic_level_3,
          videoIds: []
        });
      }
      
      topicGroups.get(key).videoIds.push(video.video_id);
    }
    
    console.log(`🏷️  Discovered ${topicGroups.size} unique topic clusters`);
    console.log(`📊 ${videosWithEmbeddings} videos have both topic assignments and embeddings`);
    
    // Step 4: Calculate centroids for each cluster
    console.log('🧮 Calculating cluster centroids...');
    
    const clusterData = [];
    let processedClusters = 0;
    
    for (const [key, group] of topicGroups) {
      try {
        // Get embeddings for all videos in this cluster
        const embeddingVectors = [];
        
        for (const videoId of group.videoIds) {
          const embedding = embeddingLookup.get(videoId);
          if (embedding) {
            embeddingVectors.push(embedding);
          }
        }
        
        if (embeddingVectors.length === 0) {
          console.warn(`⚠️  No embeddings found for cluster ${key}`);
          continue;
        }
        
        // Calculate centroid
        const centroid = calculateCentroid(embeddingVectors);
        
        if (!centroid) {
          console.warn(`⚠️  Failed to calculate centroid for cluster ${key}`);
          continue;
        }
        
        // Generate cluster ID
        const clusterId = processedClusters + 1;
        
        clusterData.push({
          cluster_id: clusterId,
          topic_name: group.micro,
          parent_topic: group.niche,
          grandparent_topic: group.domain,
          centroid_embedding: centroid,
          video_count: embeddingVectors.length
        });
        
        processedClusters++;
        
        if (processedClusters % 50 === 0) {
          console.log(`  📊 Processed ${processedClusters}/${topicGroups.size} clusters...`);
        }
        
      } catch (error) {
        console.warn(`⚠️  Error processing cluster ${key}: ${error.message}`);
        continue;
      }
    }
    
    console.log(`✅ Successfully calculated centroids for ${clusterData.length} clusters`);
    
    // Step 5: Clear existing cluster data and insert new data
    console.log('🗄️  Populating bertopic_clusters table...');
    
    // Clear existing data
    const { error: deleteError } = await supabase
      .from('bertopic_clusters')
      .delete()
      .neq('cluster_id', 0); // Delete all rows
    
    if (deleteError) {
      console.warn(`⚠️  Warning: Could not clear existing data: ${deleteError.message}`);
    }
    
    // Insert new data in batches
    const batchSize = 100;
    let insertedCount = 0;
    
    for (let i = 0; i < clusterData.length; i += batchSize) {
      const batch = clusterData.slice(i, i + batchSize);
      
      const { error: insertError } = await supabase
        .from('bertopic_clusters')
        .insert(batch);
      
      if (insertError) {
        console.error(`❌ Failed to insert batch ${Math.floor(i/batchSize) + 1}: ${insertError.message}`);
        continue;
      }
      
      insertedCount += batch.length;
      console.log(`  📥 Inserted ${insertedCount}/${clusterData.length} clusters...`);
    }
    
    // Step 6: Export summary for verification
    const summary = {
      timestamp: new Date().toISOString(),
      totalClusters: clusterData.length,
      successfulInserts: insertedCount,
      totalVideosWithEmbeddings: videosWithEmbeddings,
      averageVideosPerCluster: Math.round(videosWithEmbeddings / clusterData.length),
      sampleClusters: clusterData.slice(0, 5).map(c => ({
        cluster_id: c.cluster_id,
        topic_hierarchy: `${c.grandparent_topic} → ${c.parent_topic} → ${c.topic_name}`,
        video_count: c.video_count,
        centroid_dimension: c.centroid_embedding.length
      }))
    };
    
    await fs.writeFile(
      `/Users/brandoncullum/video-scripter/exports/cluster-centroids-summary-${new Date().toISOString().slice(0, 16).replace(':', '-')}.json`,
      JSON.stringify(summary, null, 2)
    );
    
    console.log('\n🎉 CLUSTER CENTROID CALCULATION COMPLETE!');
    console.log(`📊 Total clusters: ${clusterData.length}`);
    console.log(`📥 Successfully inserted: ${insertedCount}`);
    console.log(`📈 Average videos per cluster: ${Math.round(videosWithEmbeddings / clusterData.length)}`);
    console.log(`🎯 Real-time topic assignment is now ready!`);
    console.log('\nNext steps:');
    console.log('1. Update categorization dashboard to show "BERTopic Data Loaded: ✅"');
    console.log('2. Test topic assignment with new video imports');
    console.log('3. Run classification accuracy tests');
    
  } catch (error) {
    console.error('❌ Error calculating cluster centroids:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}