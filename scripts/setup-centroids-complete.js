#!/usr/bin/env node

/**
 * Complete Cluster Centroid Setup Script
 * 
 * This script does EVERYTHING needed to set up cluster centroids:
 * 1. Loads environment variables from .env files
 * 2. Loads title embeddings from local export
 * 3. Gets topic assignments from database  
 * 4. Calculates centroids for each cluster
 * 5. Populates bertopic_clusters table
 * 6. Exports summary report
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

// Load environment variables
async function loadEnvVars() {
  const envFiles = ['.env.local', '.env'];
  
  for (const envFile of envFiles) {
    try {
      const envPath = path.join(projectRoot, envFile);
      const envContent = await fs.readFile(envPath, 'utf-8');
      
      envContent.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
          if (value) {
            process.env[key.trim()] = value;
          }
        }
      });
      
      console.log(`✅ Loaded environment from ${envFile}`);
      break;
    } catch (error) {
      console.log(`⚠️  Could not load ${envFile}, trying next...`);
    }
  }
}

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
  console.log('🚀 Starting COMPLETE cluster centroid setup...');
  
  try {
    // Step 1: Load environment variables
    console.log('🔧 Loading environment variables...');
    await loadEnvVars();
    
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }
    
    // Step 2: Initialize Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    console.log('✅ Connected to Supabase');

    // Step 3: Load title embeddings from local exports
    console.log('📂 Loading title embeddings from local exports...');
    
    const exportsDir = path.join(projectRoot, 'exports');
    const embeddingFiles = await fs.readdir(exportsDir);
    const titleEmbeddingFiles = embeddingFiles
      .filter(f => f.startsWith('title-embeddings-') && f.endsWith('.json') && !f.includes('metadata-only'))
      .sort(); // Process in chronological order so later files override earlier duplicates
    
    console.log(`📁 Found ${titleEmbeddingFiles.length} embedding files`);
    
    // Create lookup map: id -> embedding
    const embeddingLookup = new Map();
    let totalEmbeddings = 0;
    
    for (const file of titleEmbeddingFiles) {
      try {
        const filePath = path.join(exportsDir, file);
        const fileData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        
        if (fileData.vectors) {
          fileData.vectors.forEach(vector => {
            if (vector.values && vector.values.length === 512) {
              embeddingLookup.set(vector.id, vector.values);
              totalEmbeddings++;
            }
          });
        }
      } catch (error) {
        console.warn(`⚠️  Could not load ${file}: ${error.message}`);
      }
    }
    
    console.log(`📊 Loaded ${totalEmbeddings} title embeddings from ${titleEmbeddingFiles.length} files`);
    console.log(`📥 Built embedding lookup for ${embeddingLookup.size} videos`);

    // Step 4: Get topic assignments from database
    console.log('📊 Fetching topic assignments from database...');
    
    // Get ALL videos with topic assignments using SQL directly
    console.log('📊 Executing direct SQL query to get all videos with topics...');
    
    let allClusters;
    
    const { data: rpcData, error: clustersError } = await supabase.rpc('get_all_videos_with_topics');
    
    if (clustersError) {
      // Fallback to pagination if RPC doesn't exist
      console.log('⚠️ RPC not found, using pagination fallback...');
      
      let allClustersList = [];
      let from = 0;
      const batchSize = 1000; // Smaller batch size to avoid timeouts
      let hasMore = true;
      
      // Get total count first
      const { count } = await supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .not('topic_level_1', 'is', null)
        .not('topic_level_2', 'is', null)
        .not('topic_level_3', 'is', null);
      
      console.log(`📊 Total videos with topics in database: ${count}`);
      
      while (hasMore && from < count) {
        console.log(`📥 Fetching batch: ${from + 1} to ${Math.min(from + batchSize, count)}...`);
        
        const { data: batch, error: batchError } = await supabase
          .from('videos')
          .select('id, topic_level_1, topic_level_2, topic_level_3')
          .not('topic_level_1', 'is', null)
          .not('topic_level_2', 'is', null)
          .not('topic_level_3', 'is', null)
          .order('id') // Ensure consistent ordering
          .range(from, from + batchSize - 1);
        
        if (batchError) {
          throw new Error(`Failed to fetch batch: ${batchError.message}`);
        }
        
        if (batch && batch.length > 0) {
          allClustersList = allClustersList.concat(batch);
          from += batch.length;
          console.log(`  📥 Fetched ${allClustersList.length}/${count} videos so far...`);
          
          if (batch.length < batchSize) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }
      
      allClusters = allClustersList;
    } else {
      console.log('✅ Using RPC function to fetch all videos...');
      allClusters = rpcData;
    }
    
    const clusters = allClusters;
    
    console.log(`📈 Found ${clusters.length} videos with topic assignments`);
    
    // Step 5: Group videos by topic hierarchy
    console.log('🏷️  Grouping videos by topic clusters...');
    const topicGroups = new Map();
    let videosWithEmbeddings = 0;
    
    for (const video of clusters) {
      // Only include videos that have embeddings
      if (!embeddingLookup.has(video.id)) {
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
      
      topicGroups.get(key).videoIds.push(video.id);
    }
    
    console.log(`🏷️  Discovered ${topicGroups.size} unique topic clusters`);
    console.log(`📊 ${videosWithEmbeddings} videos have both topic assignments and embeddings`);
    
    // Step 6: Calculate centroids for each cluster
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
          topic_name: `topic_${group.micro}`,
          parent_topic: `niche_${group.niche}`,
          grandparent_topic: `domain_${group.domain}`,
          centroid_embedding: centroid,
          video_count: embeddingVectors.length
        });
        
        processedClusters++;
        
        if (processedClusters % 100 === 0) {
          console.log(`  📊 Processed ${processedClusters}/${topicGroups.size} clusters...`);
        }
        
      } catch (error) {
        console.warn(`⚠️  Error processing cluster ${key}: ${error.message}`);
        continue;
      }
    }
    
    console.log(`✅ Successfully calculated centroids for ${clusterData.length} clusters`);
    
    // Step 7: Clear existing cluster data and insert new data
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
    const insertBatchSize = 100;
    let insertedCount = 0;
    
    for (let i = 0; i < clusterData.length; i += insertBatchSize) {
      const batch = clusterData.slice(i, i + insertBatchSize);
      
      const { error: insertError } = await supabase
        .from('bertopic_clusters')
        .insert(batch);
      
      if (insertError) {
        console.error(`❌ Failed to insert batch ${Math.floor(i/insertBatchSize) + 1}: ${insertError.message}`);
        continue;
      }
      
      insertedCount += batch.length;
      console.log(`  📥 Inserted ${insertedCount}/${clusterData.length} clusters...`);
    }
    
    // Step 8: Export summary for verification
    const timestamp = new Date().toISOString().slice(0, 16).replace(':', '-');
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
    
    const summaryPath = path.join(projectRoot, 'exports', `cluster-centroids-summary-${timestamp}.json`);
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    
    console.log('\n🎉 CLUSTER CENTROID SETUP COMPLETE!');
    console.log(`📊 Total clusters: ${clusterData.length}`);
    console.log(`📥 Successfully inserted: ${insertedCount}`);
    console.log(`📈 Average videos per cluster: ${Math.round(videosWithEmbeddings / clusterData.length)}`);
    console.log(`📄 Summary exported to: ${summaryPath}`);
    console.log(`🎯 Real-time topic assignment is now ready!`);
    console.log('\nNext steps:');
    console.log('1. Categorization dashboard will show "BERTopic Data Loaded: ✅"');
    console.log('2. Test topic assignment with new video imports');
    console.log('3. Run classification accuracy tests');
    
  } catch (error) {
    console.error('❌ SETUP FAILED:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});