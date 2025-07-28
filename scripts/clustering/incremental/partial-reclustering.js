#!/usr/bin/env node

/**
 * Partial Re-clustering
 * Re-clusters specific regions of the embedding space that have drifted
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { promisify } from 'util';

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

// Re-clustering configuration
const RECLUSTERING_CONFIG = {
  minClusterSize: 30,
  minSamples: 5,
  maxClustersToProcess: 10,
  neighborhoodRadius: 0.2,  // Cosine distance to include neighbors
  stabilityThreshold: 0.8    // Minimum overlap to maintain cluster identity
};

/**
 * Get videos for re-clustering from affected clusters and their neighborhoods
 */
async function getVideosForReclustering(clusterIds, includeNeighbors = true) {
  // Get videos from specified clusters
  const { data: clusterVideos, error: clusterError } = await supabase
    .from('videos')
    .select('id, title, channel_id, channel_name, view_count, published_at, title_embedding, topic_cluster_id')
    .in('topic_cluster_id', clusterIds)
    .not('title_embedding', 'is', null);

  if (clusterError) {
    throw new Error(`Failed to fetch cluster videos: ${clusterError.message}`);
  }

  const allVideos = [...(clusterVideos || [])];
  const videoIds = new Set(allVideos.map(v => v.id));

  if (includeNeighbors) {
    // Get cluster centroids
    const { data: clusters, error: centroidError } = await supabase
      .from('bertopic_clusters')
      .select('cluster_id, centroid_embedding')
      .in('cluster_id', clusterIds);

    if (centroidError) {
      throw new Error(`Failed to fetch centroids: ${centroidError.message}`);
    }

    // Find neighboring videos using vector similarity
    for (const cluster of clusters) {
      const { data: neighbors, error: neighborError } = await supabase.rpc(
        'find_similar_videos_by_embedding',
        {
          query_embedding: cluster.centroid_embedding,
          similarity_threshold: 1 - RECLUSTERING_CONFIG.neighborhoodRadius,
          max_results: 1000
        }
      );

      if (!neighborError && neighbors) {
        for (const neighbor of neighbors) {
          if (!videoIds.has(neighbor.id)) {
            videoIds.add(neighbor.id);
            allVideos.push(neighbor);
          }
        }
      }
    }
  }

  return allVideos;
}

/**
 * Prepare data for Python clustering script
 */
async function prepareClusteringData(videos, outputPath) {
  const data = videos.map(v => ({
    id: v.id,
    title: v.title,
    channel_id: v.channel_id,
    channel_name: v.channel_name,
    view_count: v.view_count,
    published_at: v.published_at,
    embedding: v.title_embedding,
    original_cluster: v.topic_cluster_id
  }));

  await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
  return data.length;
}

/**
 * Run HDBSCAN clustering using Python script
 */
async function runHDBSCANClustering(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const pythonScript = join(__dirname, 'hdbscan_partial.py');
    
    const pythonProcess = spawn('python3', [
      pythonScript,
      '--input', inputPath,
      '--output', outputPath,
      '--min_cluster_size', RECLUSTERING_CONFIG.minClusterSize.toString(),
      '--min_samples', RECLUSTERING_CONFIG.minSamples.toString()
    ]);

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python script exited with code ${code}: ${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Map new clusters to existing ones based on overlap
 */
function mapNewClustersToExisting(oldAssignments, newAssignments) {
  // Build mapping of video IDs to old clusters
  const oldClusterMap = new Map();
  oldAssignments.forEach(v => {
    if (v.original_cluster !== null && v.original_cluster !== -1) {
      oldClusterMap.set(v.id, v.original_cluster);
    }
  });

  // Calculate overlap between new and old clusters
  const clusterOverlaps = new Map();
  
  newAssignments.forEach(v => {
    if (v.new_cluster === -1) return; // Skip noise points
    
    const oldCluster = oldClusterMap.get(v.id);
    if (oldCluster === undefined) return;

    const key = `${v.new_cluster}->${oldCluster}`;
    clusterOverlaps.set(key, (clusterOverlaps.get(key) || 0) + 1);
  });

  // Determine best mapping for each new cluster
  const newToOldMapping = new Map();
  const newClusterSizes = new Map();
  
  // Count sizes of new clusters
  newAssignments.forEach(v => {
    if (v.new_cluster !== -1) {
      newClusterSizes.set(v.new_cluster, (newClusterSizes.get(v.new_cluster) || 0) + 1);
    }
  });

  // Find best old cluster for each new cluster
  for (const [newCluster, size] of newClusterSizes.entries()) {
    let bestOldCluster = null;
    let bestOverlap = 0;
    let bestOverlapRatio = 0;

    for (const [mapping, overlap] of clusterOverlaps.entries()) {
      const [newC, oldC] = mapping.split('->').map(Number);
      if (newC === newCluster) {
        const overlapRatio = overlap / size;
        if (overlapRatio > bestOverlapRatio && overlapRatio >= RECLUSTERING_CONFIG.stabilityThreshold) {
          bestOldCluster = oldC;
          bestOverlap = overlap;
          bestOverlapRatio = overlapRatio;
        }
      }
    }

    if (bestOldCluster !== null) {
      newToOldMapping.set(newCluster, {
        oldCluster: bestOldCluster,
        overlap: bestOverlap,
        overlapRatio: bestOverlapRatio,
        isStable: true
      });
    } else {
      // This is a genuinely new cluster
      newToOldMapping.set(newCluster, {
        oldCluster: null,
        overlap: 0,
        overlapRatio: 0,
        isStable: false
      });
    }
  }

  return newToOldMapping;
}

/**
 * Apply re-clustering results to database
 */
async function applyReclusteringResults(results, clusterMapping) {
  const updates = [];
  const newClusters = [];
  let nextNewClusterId = 10000; // Start new cluster IDs from a high number

  // Get max existing cluster ID
  const { data: maxCluster } = await supabase
    .from('bertopic_clusters')
    .select('cluster_id')
    .order('cluster_id', { ascending: false })
    .limit(1)
    .single();

  if (maxCluster) {
    nextNewClusterId = Math.max(nextNewClusterId, maxCluster.cluster_id + 1);
  }

  // Process each video assignment
  for (const video of results) {
    if (video.new_cluster === -1) {
      // Noise point - remove cluster assignment
      updates.push({
        video_id: video.id,
        topic_cluster_id: null,
        topic_confidence: 0,
        classified_at: new Date().toISOString()
      });
    } else {
      const mapping = clusterMapping.get(video.new_cluster);
      
      if (mapping.isStable) {
        // Map to existing cluster
        updates.push({
          video_id: video.id,
          topic_cluster_id: mapping.oldCluster,
          topic_confidence: video.confidence || 0.8,
          classified_at: new Date().toISOString()
        });
      } else {
        // Assign to new cluster
        if (!mapping.newClusterId) {
          mapping.newClusterId = nextNewClusterId++;
          newClusters.push({
            cluster_id: mapping.newClusterId,
            videos: []
          });
        }
        
        updates.push({
          video_id: video.id,
          topic_cluster_id: mapping.newClusterId,
          topic_confidence: video.confidence || 0.8,
          classified_at: new Date().toISOString()
        });
        
        // Add video to new cluster for centroid calculation
        const newCluster = newClusters.find(c => c.cluster_id === mapping.newClusterId);
        if (newCluster) {
          newCluster.videos.push(video);
        }
      }
    }
  }

  // Apply updates in batches
  console.log(`Applying ${updates.length} updates...`);
  
  const batchSize = 100;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    
    for (const update of batch) {
      const { error } = await supabase
        .from('videos')
        .update({
          topic_cluster_id: update.topic_cluster_id,
          topic_confidence: update.topic_confidence,
          classified_at: update.classified_at
        })
        .eq('id', update.video_id);

      if (error) {
        console.error(`Failed to update video ${update.video_id}:`, error);
      }
    }
  }

  // Create new clusters if needed
  if (newClusters.length > 0) {
    console.log(`Creating ${newClusters.length} new clusters...`);
    
    for (const cluster of newClusters) {
      // Calculate centroid for new cluster
      const embeddings = cluster.videos.map(v => v.embedding);
      const centroid = calculateCentroid(embeddings);
      
      // Insert new cluster (you'll need to generate appropriate names)
      const { error } = await supabase
        .from('bertopic_clusters')
        .insert({
          cluster_id: cluster.cluster_id,
          topic_name: `New Cluster ${cluster.cluster_id}`,
          parent_topic: 'Uncategorized',
          grandparent_topic: 'Uncategorized',
          centroid_embedding: centroid,
          video_count: cluster.videos.length,
          created_at: new Date().toISOString()
        });

      if (error) {
        console.error(`Failed to create cluster ${cluster.cluster_id}:`, error);
      }
    }
  }

  return {
    totalUpdates: updates.length,
    newClusters: newClusters.length,
    noisePoints: updates.filter(u => u.topic_cluster_id === null).length
  };
}

/**
 * Calculate centroid of embeddings
 */
function calculateCentroid(embeddings) {
  if (!embeddings || embeddings.length === 0) return null;
  
  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);
  
  for (const embedding of embeddings) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += embedding[i];
    }
  }
  
  for (let i = 0; i < dim; i++) {
    centroid[i] /= embeddings.length;
  }
  
  return centroid;
}

/**
 * Main execution function
 */
async function main(clusterIds = null) {
  console.log('Starting partial re-clustering...\n');

  try {
    // If no cluster IDs provided, get from drift analysis
    if (!clusterIds) {
      const driftFile = join(
        dirname(dirname(dirname(__dirname))), 
        'outputs', 
        'clustering', 
        'drift',
        `drifted_clusters_${new Date().toISOString().split('T')[0]}.json`
      );
      
      if (await fs.access(driftFile).then(() => true).catch(() => false)) {
        const driftData = JSON.parse(await fs.readFile(driftFile, 'utf-8'));
        clusterIds = driftData.clusters
          .filter(c => c.recommendations.some(r => r.priority === 'high'))
          .slice(0, RECLUSTERING_CONFIG.maxClustersToProcess)
          .map(c => c.clusterId);
      }
    }

    if (!clusterIds || clusterIds.length === 0) {
      console.log('No clusters specified for re-clustering.');
      console.log('Run drift detection first or provide cluster IDs.');
      return;
    }

    console.log(`Re-clustering ${clusterIds.length} clusters: ${clusterIds.join(', ')}\n`);

    // Get videos for re-clustering
    console.log('Fetching videos for re-clustering...');
    const videos = await getVideosForReclustering(clusterIds);
    console.log(`Found ${videos.length} videos (including neighbors)\n`);

    // Prepare data for clustering
    const tempDir = join(dirname(dirname(dirname(__dirname))), 'temp', 'clustering');
    await fs.mkdir(tempDir, { recursive: true });
    
    const inputFile = join(tempDir, `reclustering_input_${Date.now()}.json`);
    const outputFile = join(tempDir, `reclustering_output_${Date.now()}.json`);
    
    await prepareClusteringData(videos, inputFile);

    // Run HDBSCAN clustering
    console.log('Running HDBSCAN clustering...');
    await runHDBSCANClustering(inputFile, outputFile);

    // Load clustering results
    const results = JSON.parse(await fs.readFile(outputFile, 'utf-8'));
    
    // Map new clusters to existing ones
    console.log('\nMapping new clusters to existing ones...');
    const clusterMapping = mapNewClustersToExisting(videos, results);
    
    console.log(`Found ${clusterMapping.size} new clusters`);
    let stableCount = 0;
    let newCount = 0;
    
    for (const [, mapping] of clusterMapping) {
      if (mapping.isStable) stableCount++;
      else newCount++;
    }
    
    console.log(`- ${stableCount} stable (mapped to existing)`);
    console.log(`- ${newCount} genuinely new clusters\n`);

    // Apply results to database
    const updateStats = await applyReclusteringResults(results, clusterMapping);
    
    console.log('\n=== Re-clustering Complete ===');
    console.log(`Total updates: ${updateStats.totalUpdates}`);
    console.log(`New clusters created: ${updateStats.newClusters}`);
    console.log(`Noise points: ${updateStats.noisePoints}`);

    // Save summary
    const summaryFile = join(
      dirname(dirname(dirname(__dirname))),
      'outputs',
      'clustering',
      'incremental',
      `reclustering_summary_${new Date().toISOString().split('T')[0]}.json`
    );
    
    await fs.writeFile(summaryFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      clustersProcessed: clusterIds,
      videosProcessed: videos.length,
      updateStats,
      clusterMapping: Array.from(clusterMapping.entries()).map(([k, v]) => ({
        newCluster: k,
        ...v
      }))
    }, null, 2));

    // Cleanup temp files
    await fs.unlink(inputFile).catch(() => {});
    await fs.unlink(outputFile).catch(() => {});

  } catch (error) {
    console.error('Error during partial re-clustering:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const clusterIds = process.argv.slice(2).map(Number).filter(n => !isNaN(n));
  main(clusterIds.length > 0 ? clusterIds : null);
}

export { getVideosForReclustering, applyReclusteringResults };