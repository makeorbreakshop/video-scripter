#!/usr/bin/env node

/**
 * Cluster Drift Detection
 * Monitors cluster stability and detects when clusters need refreshing
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

// Drift detection thresholds
const DRIFT_THRESHOLDS = {
  centroidShift: 0.15,        // Maximum centroid movement (cosine distance)
  sizeChangeRatio: 2.0,       // Maximum cluster size change ratio
  lowConfidenceRatio: 0.3,    // Ratio of low-confidence assignments
  minClusterSize: 30,         // Minimum cluster size to consider
  outlierRatio: 0.25,         // Ratio of outliers in cluster
  timeWindow: 30              // Days to consider for recent changes
};

/**
 * Calculate cluster statistics and drift metrics
 */
async function calculateClusterDrift(clusterId) {
  // Get cluster metadata
  const { data: cluster, error: clusterError } = await supabase
    .from('bertopic_clusters')
    .select('*')
    .eq('cluster_id', clusterId)
    .single();

  if (clusterError) {
    throw new Error(`Failed to fetch cluster ${clusterId}: ${clusterError.message}`);
  }

  // Get videos in this cluster
  const { data: videos, error: videosError } = await supabase
    .from('videos')
    .select('id, title, title_embedding, topic_confidence, classified_at, view_count, published_at')
    .eq('topic_cluster_id', clusterId)
    .not('title_embedding', 'is', null);

  if (videosError) {
    throw new Error(`Failed to fetch videos for cluster ${clusterId}: ${videosError.message}`);
  }

  if (!videos || videos.length === 0) {
    return {
      clusterId,
      currentSize: 0,
      drift: false,
      metrics: { empty: true }
    };
  }

  // Calculate current centroid
  const embeddings = videos.map(v => v.title_embedding);
  const currentCentroid = calculateCentroid(embeddings);
  
  // Calculate centroid shift
  const centroidShift = 1 - cosineSimilarity(cluster.centroid_embedding, currentCentroid);

  // Calculate confidence statistics
  const lowConfidenceCount = videos.filter(v => v.topic_confidence < 0.7).length;
  const lowConfidenceRatio = lowConfidenceCount / videos.length;

  // Calculate temporal drift (recent vs old assignments)
  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - DRIFT_THRESHOLDS.timeWindow);
  
  const recentVideos = videos.filter(v => new Date(v.classified_at) > recentCutoff);
  const oldVideos = videos.filter(v => new Date(v.classified_at) <= recentCutoff);

  let temporalDrift = 0;
  if (recentVideos.length > 10 && oldVideos.length > 10) {
    const recentCentroid = calculateCentroid(recentVideos.map(v => v.title_embedding));
    const oldCentroid = calculateCentroid(oldVideos.map(v => v.title_embedding));
    temporalDrift = 1 - cosineSimilarity(recentCentroid, oldCentroid);
  }

  // Calculate outlier ratio (videos far from centroid)
  const distances = embeddings.map(emb => 1 - cosineSimilarity(emb, currentCentroid));
  const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
  const outlierThreshold = avgDistance + 2 * standardDeviation(distances);
  const outlierCount = distances.filter(d => d > outlierThreshold).length;
  const outlierRatio = outlierCount / videos.length;

  // Size change detection
  const sizeChangeRatio = Math.abs(videos.length - cluster.video_count) / cluster.video_count;

  // Determine if cluster has drifted
  const driftDetected = 
    centroidShift > DRIFT_THRESHOLDS.centroidShift ||
    lowConfidenceRatio > DRIFT_THRESHOLDS.lowConfidenceRatio ||
    sizeChangeRatio > DRIFT_THRESHOLDS.sizeChangeRatio ||
    outlierRatio > DRIFT_THRESHOLDS.outlierRatio ||
    temporalDrift > DRIFT_THRESHOLDS.centroidShift;

  return {
    clusterId,
    clusterName: cluster.topic_name,
    originalSize: cluster.video_count,
    currentSize: videos.length,
    drift: driftDetected,
    metrics: {
      centroidShift,
      lowConfidenceRatio,
      sizeChangeRatio,
      outlierRatio,
      temporalDrift,
      avgDistance,
      recentVideosCount: recentVideos.length,
      oldVideosCount: oldVideos.length
    },
    recommendations: generateRecommendations({
      centroidShift,
      lowConfidenceRatio,
      sizeChangeRatio,
      outlierRatio,
      temporalDrift,
      currentSize: videos.length
    })
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
 * Calculate cosine similarity
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
 * Calculate standard deviation
 */
function standardDeviation(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Generate recommendations based on drift metrics
 */
function generateRecommendations(metrics) {
  const recommendations = [];

  if (metrics.centroidShift > DRIFT_THRESHOLDS.centroidShift) {
    recommendations.push({
      type: 'centroid_update',
      priority: 'high',
      message: `Centroid has shifted by ${(metrics.centroidShift * 100).toFixed(1)}%. Update cluster centroid.`
    });
  }

  if (metrics.lowConfidenceRatio > DRIFT_THRESHOLDS.lowConfidenceRatio) {
    recommendations.push({
      type: 'reclassification',
      priority: 'medium',
      message: `${(metrics.lowConfidenceRatio * 100).toFixed(1)}% of videos have low confidence. Consider reclassification.`
    });
  }

  if (metrics.sizeChangeRatio > DRIFT_THRESHOLDS.sizeChangeRatio) {
    recommendations.push({
      type: 'split_or_merge',
      priority: 'high',
      message: `Cluster size changed by ${(metrics.sizeChangeRatio * 100).toFixed(1)}%. Consider splitting or merging.`
    });
  }

  if (metrics.outlierRatio > DRIFT_THRESHOLDS.outlierRatio) {
    recommendations.push({
      type: 'outlier_review',
      priority: 'medium',
      message: `${(metrics.outlierRatio * 100).toFixed(1)}% of videos are outliers. Review cluster coherence.`
    });
  }

  if (metrics.temporalDrift > DRIFT_THRESHOLDS.centroidShift) {
    recommendations.push({
      type: 'evolution_tracking',
      priority: 'low',
      message: `Cluster is evolving over time (drift: ${(metrics.temporalDrift * 100).toFixed(1)}%).`
    });
  }

  if (metrics.currentSize < DRIFT_THRESHOLDS.minClusterSize) {
    recommendations.push({
      type: 'merge_candidate',
      priority: 'medium',
      message: `Cluster has only ${metrics.currentSize} videos. Consider merging with similar clusters.`
    });
  }

  return recommendations;
}

/**
 * Analyze all clusters for drift
 */
async function analyzeAllClusters() {
  console.log('Analyzing cluster drift...\n');

  // Get all clusters
  const { data: clusters, error } = await supabase
    .from('bertopic_clusters')
    .select('cluster_id')
    .order('cluster_id');

  if (error) {
    throw new Error(`Failed to fetch clusters: ${error.message}`);
  }

  const results = [];
  const driftedClusters = [];

  // Analyze each cluster
  for (const cluster of clusters) {
    try {
      console.log(`Analyzing cluster ${cluster.cluster_id}...`);
      const driftAnalysis = await calculateClusterDrift(cluster.cluster_id);
      results.push(driftAnalysis);

      if (driftAnalysis.drift) {
        driftedClusters.push(driftAnalysis);
      }
    } catch (error) {
      console.error(`Error analyzing cluster ${cluster.cluster_id}:`, error.message);
    }
  }

  return { results, driftedClusters };
}

/**
 * Save drift analysis results
 */
async function saveDriftAnalysis(results, driftedClusters) {
  const timestamp = new Date().toISOString();
  
  // Save detailed results
  const outputDir = join(dirname(dirname(dirname(__dirname))), 'outputs', 'clustering', 'drift');
  await fs.mkdir(outputDir, { recursive: true });
  
  const resultsFile = join(outputDir, `drift_analysis_${timestamp.split('T')[0]}.json`);
  await fs.writeFile(resultsFile, JSON.stringify({
    timestamp,
    totalClusters: results.length,
    driftedClusters: driftedClusters.length,
    driftRatio: driftedClusters.length / results.length,
    thresholds: DRIFT_THRESHOLDS,
    results
  }, null, 2));

  // Save summary for drifted clusters
  if (driftedClusters.length > 0) {
    const driftFile = join(outputDir, `drifted_clusters_${timestamp.split('T')[0]}.json`);
    await fs.writeFile(driftFile, JSON.stringify({
      timestamp,
      count: driftedClusters.length,
      clusters: driftedClusters.map(c => ({
        clusterId: c.clusterId,
        clusterName: c.clusterName,
        metrics: c.metrics,
        recommendations: c.recommendations
      }))
    }, null, 2));
  }

  // Create actionable report
  const reportFile = join(outputDir, `drift_report_${timestamp.split('T')[0]}.md`);
  let report = `# Cluster Drift Analysis Report\n\n`;
  report += `Generated: ${timestamp}\n\n`;
  report += `## Summary\n\n`;
  report += `- Total clusters analyzed: ${results.length}\n`;
  report += `- Clusters with drift: ${driftedClusters.length} (${(driftedClusters.length/results.length*100).toFixed(1)}%)\n\n`;

  if (driftedClusters.length > 0) {
    report += `## Drifted Clusters\n\n`;
    
    // Group by priority
    const highPriority = driftedClusters.filter(c => 
      c.recommendations.some(r => r.priority === 'high')
    );
    const mediumPriority = driftedClusters.filter(c => 
      c.recommendations.some(r => r.priority === 'medium') &&
      !c.recommendations.some(r => r.priority === 'high')
    );

    if (highPriority.length > 0) {
      report += `### High Priority (${highPriority.length} clusters)\n\n`;
      for (const cluster of highPriority) {
        report += `#### Cluster ${cluster.clusterId}: ${cluster.clusterName}\n`;
        report += `- Size: ${cluster.originalSize} → ${cluster.currentSize}\n`;
        report += `- Recommendations:\n`;
        cluster.recommendations
          .filter(r => r.priority === 'high')
          .forEach(r => report += `  - ${r.message}\n`);
        report += '\n';
      }
    }

    if (mediumPriority.length > 0) {
      report += `### Medium Priority (${mediumPriority.length} clusters)\n\n`;
      for (const cluster of mediumPriority) {
        report += `#### Cluster ${cluster.clusterId}: ${cluster.clusterName}\n`;
        report += `- Size: ${cluster.originalSize} → ${cluster.currentSize}\n`;
        report += `- Recommendations:\n`;
        cluster.recommendations
          .filter(r => r.priority === 'medium')
          .forEach(r => report += `  - ${r.message}\n`);
        report += '\n';
      }
    }
  }

  await fs.writeFile(reportFile, report);
  
  console.log(`\nResults saved to: ${outputDir}`);
  
  return { resultsFile, driftFile: driftedClusters.length > 0 ? driftFile : null, reportFile };
}

/**
 * Main execution function
 */
async function main() {
  try {
    const { results, driftedClusters } = await analyzeAllClusters();
    
    console.log('\n=== Drift Analysis Complete ===');
    console.log(`Total clusters: ${results.length}`);
    console.log(`Drifted clusters: ${driftedClusters.length} (${(driftedClusters.length/results.length*100).toFixed(1)}%)`);
    
    if (driftedClusters.length > 0) {
      console.log('\nDrifted clusters requiring attention:');
      driftedClusters
        .sort((a, b) => {
          // Sort by highest priority recommendations
          const getPriority = (c) => {
            if (c.recommendations.some(r => r.priority === 'high')) return 3;
            if (c.recommendations.some(r => r.priority === 'medium')) return 2;
            return 1;
          };
          return getPriority(b) - getPriority(a);
        })
        .slice(0, 10)
        .forEach(c => {
          console.log(`\n- Cluster ${c.clusterId}: ${c.clusterName}`);
          console.log(`  Size: ${c.originalSize} → ${c.currentSize}`);
          c.recommendations.slice(0, 2).forEach(r => 
            console.log(`  [${r.priority.toUpperCase()}] ${r.message}`)
          );
        });
    }

    await saveDriftAnalysis(results, driftedClusters);

  } catch (error) {
    console.error('Error during drift analysis:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { calculateClusterDrift, analyzeAllClusters };