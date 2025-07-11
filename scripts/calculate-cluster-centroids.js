#!/usr/bin/env node

/**
 * Calculate Cluster Centroids from Existing Video Assignments
 * 
 * This script:
 * 1. Finds all unique topic clusters from existing video assignments
 * 2. Calculates centroid embeddings for each cluster (average of all video title embeddings)
 * 3. Populates the bertopic_clusters table with topic hierarchy and centroids
 * 4. Enables real-time topic assignment for new videos
 */

import { createClient } from '@supabase/supabase-js';
import { PineconeService } from '../lib/pinecone-service.js';
import * as fs from 'fs/promises';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const pineconeService = new PineconeService();

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

/**
 * Generate unique cluster ID from topic hierarchy
 */
function generateClusterId(domain, niche, micro) {
  return `${domain}__${niche}__${micro}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 100);
}

async function main() {
  console.log('🚀 Starting cluster centroid calculation...');
  
  try {
    // Step 1: Get all unique topic combinations with video counts
    console.log('📊 Finding unique topic clusters...');
    
    const { data: clusters, error: clustersError } = await supabase
      .from('videos')
      .select(`
        topic_level_1,
        topic_level_2, 
        topic_level_3,
        video_id
      `)
      .not('topic_level_1', 'is', null)
      .not('topic_level_2', 'is', null)
      .not('topic_level_3', 'is', null)
      .eq('pinecone_embedded', true);
    
    if (clustersError) {
      throw new Error(`Failed to fetch topic clusters: ${clustersError.message}`);
    }
    
    console.log(`📈 Found ${clusters.length} videos with topic assignments`);
    
    // Step 2: Group videos by topic hierarchy
    const topicGroups = new Map();
    
    for (const video of clusters) {
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
    
    // Step 3: Calculate centroids for each cluster
    console.log('🧮 Calculating cluster centroids...');
    
    const clusterData = [];
    let processedClusters = 0;
    
    for (const [key, group] of topicGroups) {
      try {
        // Fetch embeddings from Pinecone for all videos in this cluster
        console.log(`  📥 Fetching embeddings for cluster ${key} (${group.videoIds.length} videos)...`);
        
        const embeddingVectors = [];
        
        // Fetch embeddings in batches to avoid overwhelming Pinecone
        const batchSize = 100;
        for (let i = 0; i < group.videoIds.length; i += batchSize) {
          const batch = group.videoIds.slice(i, i + batchSize);
          
          try {
            const vectors = await pineconeService.fetchVectors(batch);
            
            // Extract embedding arrays from Pinecone response
            for (const vectorId of batch) {
              if (vectors[vectorId] && vectors[vectorId].values) {
                embeddingVectors.push(vectors[vectorId].values);
              }
            }
          } catch (pineconeError) {
            console.warn(`⚠️  Failed to fetch batch from Pinecone: ${pineconeError.message}`);
            continue;
          }
        }
        
        if (embeddingVectors.length === 0) {
          console.warn(`⚠️  No embeddings found in Pinecone for cluster ${key}`);
          continue;
        }
        
        console.log(`  ✅ Found ${embeddingVectors.length}/${group.videoIds.length} embeddings for cluster ${key}`);
        
        // Calculate centroid
        const centroid = calculateCentroid(embeddingVectors);
        
        if (!centroid) {
          console.warn(`⚠️  Failed to calculate centroid for cluster ${key}`);
          continue;
        }
        
        // Generate cluster ID
        const clusterId = generateClusterId(group.domain, group.niche, group.micro);
        
        clusterData.push({
          cluster_id: clusterId,
          topic_name: group.micro,
          parent_topic: group.niche,
          grandparent_topic: group.domain,
          centroid_embedding: centroid,
          video_count: group.videoIds.length
        });
        
        processedClusters++;
        
        if (processedClusters % 10 === 0) {
          console.log(`  📊 Processed ${processedClusters}/${topicGroups.size} clusters...`);
        }
        
      } catch (error) {
        console.warn(`⚠️  Error processing cluster ${key}: ${error.message}`);
        continue;
      }
    }
    
    console.log(`✅ Successfully calculated centroids for ${clusterData.length} clusters`);
    
    // Step 4: Clear existing cluster data and insert new data
    console.log('🗄️  Populating bertopic_clusters table...');
    
    // Clear existing data
    const { error: deleteError } = await supabase
      .from('bertopic_clusters')
      .delete()
      .neq('cluster_id', ''); // Delete all rows
    
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
    
    // Step 5: Export summary for verification
    const summary = {
      timestamp: new Date().toISOString(),
      totalClusters: clusterData.length,
      successfulInserts: insertedCount,
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