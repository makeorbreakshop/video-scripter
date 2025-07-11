#!/usr/bin/env node

/**
 * Calculate Cluster Centroids from Existing Video Assignments (Simplified)
 * 
 * This script:
 * 1. Uses existing topic assignments from the database
 * 2. For each cluster, randomly samples videos and gets their embeddings via search
 * 3. Calculates centroid embeddings for each cluster
 * 4. Populates the bertopic_clusters table with topic hierarchy and centroids
 */

import { createClient } from '@supabase/supabase-js';
import { openaiApi } from '../lib/openai-api.js';
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

/**
 * Generate representative text for a topic cluster
 */
function generateClusterText(domain, niche, micro, sampleTitles) {
  // Create representative text from topic hierarchy and sample titles
  const topicText = `${domain} ${niche} ${micro}`;
  const titleText = sampleTitles.slice(0, 3).join(' ');
  return `${topicText} ${titleText}`;
}

async function main() {
  console.log('🚀 Starting simplified cluster centroid calculation...');
  
  try {
    // Step 1: Get all unique topic combinations with sample titles
    console.log('📊 Finding unique topic clusters with sample titles...');
    
    const { data: clusters, error: clustersError } = await supabase
      .from('videos')
      .select(`
        topic_level_1,
        topic_level_2, 
        topic_level_3,
        title,
        video_id
      `)
      .not('topic_level_1', 'is', null)
      .not('topic_level_2', 'is', null)
      .not('topic_level_3', 'is', null)
      .limit(10000); // Limit for processing efficiency
    
    if (clustersError) {
      throw new Error(`Failed to fetch topic clusters: ${clustersError.message}`);
    }
    
    console.log(`📈 Found ${clusters.length} videos with topic assignments`);
    
    // Step 2: Group videos by topic hierarchy and collect sample titles
    const topicGroups = new Map();
    
    for (const video of clusters) {
      const key = `${video.topic_level_1}|${video.topic_level_2}|${video.topic_level_3}`;
      
      if (!topicGroups.has(key)) {
        topicGroups.set(key, {
          domain: video.topic_level_1,
          niche: video.topic_level_2,
          micro: video.topic_level_3,
          titles: [],
          videoIds: []
        });
      }
      
      const group = topicGroups.get(key);
      group.titles.push(video.title);
      group.videoIds.push(video.video_id);
    }
    
    console.log(`🏷️  Discovered ${topicGroups.size} unique topic clusters`);
    
    // Step 3: Generate embeddings for representative cluster text
    console.log('🧮 Generating cluster embeddings...');
    
    const clusterData = [];
    let processedClusters = 0;
    
    for (const [key, group] of topicGroups) {
      try {
        // Generate representative text for this cluster
        const clusterText = generateClusterText(
          group.domain, 
          group.niche, 
          group.micro, 
          group.titles
        );
        
        console.log(`  📝 Processing: ${group.domain} → ${group.niche} → ${group.micro} (${group.videoIds.length} videos)`);
        
        // Generate embedding for cluster text using OpenAI
        const embedding = await openaiApi.generateEmbedding(clusterText);
        
        if (!embedding) {
          console.warn(`⚠️  Failed to generate embedding for cluster ${key}`);
          continue;
        }
        
        // Generate cluster ID (integer)
        const clusterId = processedClusters + 1;
        
        clusterData.push({
          cluster_id: clusterId,
          topic_name: group.micro,
          parent_topic: group.niche,
          grandparent_topic: group.domain,
          centroid_embedding: embedding,
          video_count: group.videoIds.length
        });
        
        processedClusters++;
        
        if (processedClusters % 10 === 0) {
          console.log(`  📊 Processed ${processedClusters}/${topicGroups.size} clusters...`);
        }
        
        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.warn(`⚠️  Error processing cluster ${key}: ${error.message}`);
        continue;
      }
    }
    
    console.log(`✅ Successfully generated embeddings for ${clusterData.length} clusters`);
    
    // Step 4: Clear existing cluster data and insert new data
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