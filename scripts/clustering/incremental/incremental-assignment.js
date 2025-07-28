#!/usr/bin/env node

/**
 * Incremental Cluster Assignment
 * Assigns new videos to existing clusters using nearest centroid matching
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { promises as fs } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(dirname(dirname(dirname(__dirname))), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Configuration
const BATCH_SIZE = 1000;
const ASSIGNMENT_THRESHOLD = 0.65; // Minimum cosine similarity for assignment
const MAX_RETRIES = 3;

/**
 * Get new videos that haven't been assigned to clusters
 */
async function getUnassignedVideos(limit = BATCH_SIZE) {
  const { data, error } = await supabase
    .from('videos')
    .select('id, title, channel_id, channel_name, view_count, published_at, title_embedding')
    .is('topic_cluster_id', null)
    .not('title_embedding', 'is', null)
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch unassigned videos: ${error.message}`);
  }

  return data || [];
}

/**
 * Get cluster centroids from the database
 */
async function getClusterCentroids() {
  const { data, error } = await supabase
    .from('bertopic_clusters')
    .select('cluster_id, topic_name, parent_topic, grandparent_topic, centroid_embedding, video_count')
    .order('cluster_id');

  if (error) {
    throw new Error(`Failed to fetch cluster centroids: ${error.message}`);
  }

  return data || [];
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vec1, vec2) {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Find the best matching cluster for a video embedding
 */
function findBestCluster(embedding, clusters) {
  let bestCluster = null;
  let bestSimilarity = -1;

  for (const cluster of clusters) {
    const similarity = cosineSimilarity(embedding, cluster.centroid_embedding);
    
    if (similarity > bestSimilarity && similarity >= ASSIGNMENT_THRESHOLD) {
      bestSimilarity = similarity;
      bestCluster = {
        ...cluster,
        similarity
      };
    }
  }

  return bestCluster;
}

/**
 * Assign videos to clusters in batches
 */
async function assignVideosToClusters(videos, clusters) {
  const assignments = [];
  const unassigned = [];
  
  console.log(`Processing ${videos.length} videos...`);

  for (const video of videos) {
    const bestCluster = findBestCluster(video.title_embedding, clusters);
    
    if (bestCluster) {
      assignments.push({
        video_id: video.id,
        cluster_id: bestCluster.cluster_id,
        topic_level_1: bestCluster.grandparent_topic,
        topic_level_2: bestCluster.parent_topic,
        topic_level_3: bestCluster.topic_name,
        topic_cluster_id: bestCluster.cluster_id,
        topic_confidence: bestCluster.similarity,
        classified_at: new Date().toISOString()
      });
    } else {
      unassigned.push({
        video_id: video.id,
        title: video.title,
        channel_name: video.channel_name
      });
    }
  }

  return { assignments, unassigned };
}

/**
 * Save assignments to the database
 */
async function saveAssignments(assignments) {
  if (assignments.length === 0) return { success: 0, failed: 0 };

  let success = 0;
  let failed = 0;

  // Process in smaller batches to avoid database timeouts
  const batchSize = 100;
  
  for (let i = 0; i < assignments.length; i += batchSize) {
    const batch = assignments.slice(i, i + batchSize);
    
    try {
      // Update videos table
      for (const assignment of batch) {
        const { error } = await supabase
          .from('videos')
          .update({
            topic_level_1: assignment.topic_level_1,
            topic_level_2: assignment.topic_level_2,
            topic_level_3: assignment.topic_level_3,
            topic_cluster_id: assignment.topic_cluster_id,
            topic_confidence: assignment.topic_confidence,
            classified_at: assignment.classified_at
          })
          .eq('id', assignment.video_id);

        if (error) {
          console.error(`Failed to update video ${assignment.video_id}:`, error);
          failed++;
        } else {
          success++;
        }
      }
    } catch (error) {
      console.error('Batch update failed:', error);
      failed += batch.length;
    }
  }

  return { success, failed };
}

/**
 * Log assignment statistics
 */
async function logAssignmentStats(stats) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    videos_processed: stats.totalProcessed,
    videos_assigned: stats.assigned,
    videos_unassigned: stats.unassigned,
    assignment_rate: (stats.assigned / stats.totalProcessed * 100).toFixed(2) + '%',
    success_saves: stats.successSaves,
    failed_saves: stats.failedSaves,
    clusters_used: stats.clustersUsed,
    average_confidence: stats.avgConfidence.toFixed(3)
  };

  // Save to log file
  const logDir = join(dirname(dirname(dirname(__dirname))), 'outputs', 'clustering', 'incremental');
  await fs.mkdir(logDir, { recursive: true });
  
  const logFile = join(logDir, `assignment_log_${new Date().toISOString().split('T')[0]}.jsonl`);
  await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');

  // Also save to database for tracking
  await supabase
    .from('cluster_assignment_logs')
    .insert({
      log_type: 'incremental_assignment',
      stats: logEntry,
      created_at: new Date().toISOString()
    });

  return logEntry;
}

/**
 * Main execution function
 */
async function main() {
  console.log('Starting incremental cluster assignment...\n');

  try {
    // Get cluster centroids
    console.log('Loading cluster centroids...');
    const clusters = await getClusterCentroids();
    console.log(`Loaded ${clusters.length} clusters\n`);

    if (clusters.length === 0) {
      console.error('No clusters found! Run initial clustering first.');
      process.exit(1);
    }

    let totalProcessed = 0;
    let totalAssigned = 0;
    let totalUnassigned = 0;
    let hasMore = true;

    const allAssignments = [];
    const clustersUsed = new Set();

    while (hasMore) {
      // Get batch of unassigned videos
      const videos = await getUnassignedVideos(BATCH_SIZE);
      
      if (videos.length === 0) {
        hasMore = false;
        break;
      }

      console.log(`\nProcessing batch of ${videos.length} videos...`);

      // Assign videos to clusters
      const { assignments, unassigned } = await assignVideosToClusters(videos, clusters);
      
      // Track statistics
      totalProcessed += videos.length;
      totalAssigned += assignments.length;
      totalUnassigned += unassigned.length;
      
      assignments.forEach(a => {
        clustersUsed.add(a.cluster_id);
        allAssignments.push(a);
      });

      // Save assignments
      const { success, failed } = await saveAssignments(assignments);
      
      console.log(`Assigned: ${assignments.length}, Unassigned: ${unassigned.length}`);
      console.log(`Saved: ${success}, Failed: ${failed}`);

      // Save unassigned videos for review
      if (unassigned.length > 0) {
        const unassignedFile = join(
          dirname(dirname(dirname(__dirname))), 
          'outputs', 
          'clustering', 
          'incremental',
          `unassigned_${new Date().toISOString().split('T')[0]}.jsonl`
        );
        
        for (const video of unassigned) {
          await fs.appendFile(unassignedFile, JSON.stringify(video) + '\n');
        }
      }

      // Continue if we got a full batch
      hasMore = videos.length === BATCH_SIZE;
    }

    // Calculate statistics
    const avgConfidence = allAssignments.length > 0
      ? allAssignments.reduce((sum, a) => sum + a.topic_confidence, 0) / allAssignments.length
      : 0;

    const stats = {
      totalProcessed,
      assigned: totalAssigned,
      unassigned: totalUnassigned,
      clustersUsed: clustersUsed.size,
      avgConfidence,
      successSaves: totalAssigned,
      failedSaves: 0
    };

    // Log final statistics
    console.log('\n=== Assignment Complete ===');
    console.log(`Total videos processed: ${totalProcessed}`);
    console.log(`Successfully assigned: ${totalAssigned} (${(totalAssigned/totalProcessed*100).toFixed(1)}%)`);
    console.log(`Could not assign: ${totalUnassigned} (${(totalUnassigned/totalProcessed*100).toFixed(1)}%)`);
    console.log(`Clusters used: ${clustersUsed.size} / ${clusters.length}`);
    console.log(`Average confidence: ${avgConfidence.toFixed(3)}`);

    await logAssignmentStats(stats);

  } catch (error) {
    console.error('Error during incremental assignment:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { getUnassignedVideos, assignVideosToClusters, saveAssignments };