#!/usr/bin/env node

/**
 * Cluster Evolution Tracking
 * Tracks how clusters change over time and maintains historical records
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

/**
 * Create cluster evolution tracking tables if they don't exist
 */
async function ensureEvolutionTables() {
  // Cluster snapshots table
  const { error: snapshotError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS cluster_snapshots (
        id SERIAL PRIMARY KEY,
        cluster_id INTEGER NOT NULL,
        snapshot_date DATE NOT NULL,
        video_count INTEGER NOT NULL,
        centroid_embedding VECTOR(512),
        avg_views BIGINT,
        avg_age_days FLOAT,
        metadata JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(cluster_id, snapshot_date)
      );
      
      CREATE INDEX IF NOT EXISTS idx_cluster_snapshots_date 
        ON cluster_snapshots(snapshot_date);
      CREATE INDEX IF NOT EXISTS idx_cluster_snapshots_cluster 
        ON cluster_snapshots(cluster_id, snapshot_date);
    `
  });

  if (snapshotError) {
    console.error('Error creating snapshots table:', snapshotError);
  }

  // Cluster transitions table
  const { error: transitionError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS cluster_transitions (
        id SERIAL PRIMARY KEY,
        video_id TEXT NOT NULL REFERENCES videos(id),
        from_cluster_id INTEGER,
        to_cluster_id INTEGER,
        transition_date DATE NOT NULL,
        confidence_change FLOAT,
        reason TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      CREATE INDEX IF NOT EXISTS idx_cluster_transitions_video 
        ON cluster_transitions(video_id);
      CREATE INDEX IF NOT EXISTS idx_cluster_transitions_date 
        ON cluster_transitions(transition_date);
      CREATE INDEX IF NOT EXISTS idx_cluster_transitions_clusters 
        ON cluster_transitions(from_cluster_id, to_cluster_id);
    `
  });

  if (transitionError) {
    console.error('Error creating transitions table:', transitionError);
  }

  // Cluster metrics table
  const { error: metricsError } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS cluster_evolution_metrics (
        id SERIAL PRIMARY KEY,
        cluster_id INTEGER NOT NULL,
        metric_date DATE NOT NULL,
        growth_rate FLOAT,
        churn_rate FLOAT,
        stability_score FLOAT,
        centroid_drift FLOAT,
        avg_confidence FLOAT,
        performance_trend FLOAT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(cluster_id, metric_date)
      );
      
      CREATE INDEX IF NOT EXISTS idx_evolution_metrics_date 
        ON cluster_evolution_metrics(metric_date);
      CREATE INDEX IF NOT EXISTS idx_evolution_metrics_cluster 
        ON cluster_evolution_metrics(cluster_id, metric_date);
    `
  });

  if (metricsError) {
    console.error('Error creating metrics table:', metricsError);
  }
}

/**
 * Take a snapshot of current cluster state
 */
async function takeClusterSnapshot(clusterId) {
  const today = new Date().toISOString().split('T')[0];

  // Get current videos in cluster
  const { data: videos, error: videosError } = await supabase
    .from('videos')
    .select('id, title, view_count, published_at, title_embedding, topic_confidence')
    .eq('topic_cluster_id', clusterId)
    .not('title_embedding', 'is', null);

  if (videosError || !videos || videos.length === 0) {
    return null;
  }

  // Calculate centroid
  const embeddings = videos.map(v => v.title_embedding);
  const centroid = calculateCentroid(embeddings);

  // Calculate metrics
  const avgViews = videos.reduce((sum, v) => sum + (v.view_count || 0), 0) / videos.length;
  const avgAge = videos.reduce((sum, v) => {
    const age = (Date.now() - new Date(v.published_at).getTime()) / (1000 * 60 * 60 * 24);
    return sum + age;
  }, 0) / videos.length;

  // Get topic distribution
  const topicCounts = {};
  videos.forEach(v => {
    const confidence = v.topic_confidence || 0;
    const bucket = Math.floor(confidence * 10) / 10;
    topicCounts[bucket] = (topicCounts[bucket] || 0) + 1;
  });

  const snapshot = {
    cluster_id: clusterId,
    snapshot_date: today,
    video_count: videos.length,
    centroid_embedding: centroid,
    avg_views: Math.round(avgViews),
    avg_age_days: avgAge,
    metadata: {
      confidence_distribution: topicCounts,
      top_videos: videos
        .sort((a, b) => b.view_count - a.view_count)
        .slice(0, 5)
        .map(v => ({ id: v.id, title: v.title, views: v.view_count }))
    }
  };

  // Save snapshot
  const { error: insertError } = await supabase
    .from('cluster_snapshots')
    .upsert(snapshot, { onConflict: 'cluster_id,snapshot_date' });

  if (insertError) {
    console.error(`Error saving snapshot for cluster ${clusterId}:`, insertError);
    return null;
  }

  return snapshot;
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
 * Track video transitions between clusters
 */
async function trackTransitions() {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Get videos that changed clusters
  const { data: transitions, error } = await supabase.rpc('exec_sql', {
    sql: `
      WITH yesterday_state AS (
        SELECT DISTINCT ON (video_id) 
          video_id, 
          to_cluster_id as cluster_id
        FROM cluster_transitions
        WHERE transition_date <= $1
        ORDER BY video_id, transition_date DESC
      ),
      today_state AS (
        SELECT 
          id as video_id,
          topic_cluster_id as cluster_id,
          topic_confidence
        FROM videos
        WHERE topic_cluster_id IS NOT NULL
      )
      SELECT 
        t.video_id,
        COALESCE(y.cluster_id, -1) as from_cluster_id,
        t.cluster_id as to_cluster_id,
        t.topic_confidence
      FROM today_state t
      LEFT JOIN yesterday_state y ON t.video_id = y.video_id
      WHERE COALESCE(y.cluster_id, -1) != t.cluster_id
    `,
    params: [yesterday]
  });

  if (error) {
    console.error('Error finding transitions:', error);
    return [];
  }

  const transitionRecords = [];
  
  for (const trans of transitions || []) {
    const reason = trans.from_cluster_id === -1 ? 'new_assignment' : 'reassignment';
    
    transitionRecords.push({
      video_id: trans.video_id,
      from_cluster_id: trans.from_cluster_id === -1 ? null : trans.from_cluster_id,
      to_cluster_id: trans.to_cluster_id,
      transition_date: today,
      confidence_change: trans.topic_confidence,
      reason
    });
  }

  // Save transitions
  if (transitionRecords.length > 0) {
    const { error: insertError } = await supabase
      .from('cluster_transitions')
      .insert(transitionRecords);

    if (insertError) {
      console.error('Error saving transitions:', insertError);
    }
  }

  return transitionRecords;
}

/**
 * Calculate evolution metrics for a cluster
 */
async function calculateEvolutionMetrics(clusterId) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today - 30 * 24 * 60 * 60 * 1000);
  const todayStr = today.toISOString().split('T')[0];

  // Get historical snapshots
  const { data: snapshots, error: snapshotError } = await supabase
    .from('cluster_snapshots')
    .select('*')
    .eq('cluster_id', clusterId)
    .gte('snapshot_date', thirtyDaysAgo.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true });

  if (snapshotError || !snapshots || snapshots.length < 2) {
    return null;
  }

  // Get transitions for this cluster
  const { data: transitions, error: transitionError } = await supabase
    .from('cluster_transitions')
    .select('*')
    .or(`from_cluster_id.eq.${clusterId},to_cluster_id.eq.${clusterId}`)
    .gte('transition_date', thirtyDaysAgo.toISOString().split('T')[0]);

  const currentSnapshot = snapshots[snapshots.length - 1];
  const previousSnapshot = snapshots[snapshots.length - 2];

  // Calculate growth rate
  const growthRate = previousSnapshot.video_count > 0
    ? (currentSnapshot.video_count - previousSnapshot.video_count) / previousSnapshot.video_count
    : 0;

  // Calculate churn rate
  const outflows = (transitions || []).filter(t => 
    t.from_cluster_id === clusterId && 
    t.transition_date === todayStr
  ).length;
  const churnRate = currentSnapshot.video_count > 0
    ? outflows / currentSnapshot.video_count
    : 0;

  // Calculate centroid drift
  const centroidDrift = currentSnapshot.centroid_embedding && previousSnapshot.centroid_embedding
    ? 1 - cosineSimilarity(currentSnapshot.centroid_embedding, previousSnapshot.centroid_embedding)
    : 0;

  // Calculate stability score (inverse of volatility)
  const sizeChanges = [];
  for (let i = 1; i < snapshots.length; i++) {
    const change = Math.abs(snapshots[i].video_count - snapshots[i-1].video_count) / snapshots[i-1].video_count;
    sizeChanges.push(change);
  }
  const avgVolatility = sizeChanges.reduce((a, b) => a + b, 0) / sizeChanges.length;
  const stabilityScore = 1 - Math.min(avgVolatility, 1);

  // Calculate average confidence
  const avgConfidence = currentSnapshot.metadata?.confidence_distribution
    ? Object.entries(currentSnapshot.metadata.confidence_distribution)
        .reduce((sum, [conf, count]) => sum + parseFloat(conf) * count, 0) / currentSnapshot.video_count
    : 0;

  // Calculate performance trend
  const performanceTrend = snapshots.length > 1
    ? (currentSnapshot.avg_views - snapshots[0].avg_views) / snapshots[0].avg_views
    : 0;

  return {
    cluster_id: clusterId,
    metric_date: todayStr,
    growth_rate: growthRate,
    churn_rate: churnRate,
    stability_score: stabilityScore,
    centroid_drift: centroidDrift,
    avg_confidence: avgConfidence,
    performance_trend: performanceTrend
  };
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
 * Generate evolution report
 */
async function generateEvolutionReport() {
  const reportDate = new Date().toISOString().split('T')[0];
  
  // Get all evolution metrics for today
  const { data: metrics, error } = await supabase
    .from('cluster_evolution_metrics')
    .select('*')
    .eq('metric_date', reportDate)
    .order('growth_rate', { ascending: false });

  if (error || !metrics) {
    return null;
  }

  // Identify interesting patterns
  const fastGrowing = metrics.filter(m => m.growth_rate > 0.1);
  const shrinking = metrics.filter(m => m.growth_rate < -0.1);
  const highChurn = metrics.filter(m => m.churn_rate > 0.2);
  const drifting = metrics.filter(m => m.centroid_drift > 0.1);
  const unstable = metrics.filter(m => m.stability_score < 0.7);

  const report = {
    date: reportDate,
    summary: {
      total_clusters_tracked: metrics.length,
      fast_growing: fastGrowing.length,
      shrinking: shrinking.length,
      high_churn: highChurn.length,
      drifting: drifting.length,
      unstable: unstable.length
    },
    highlights: {
      fastest_growing: fastGrowing.slice(0, 5).map(m => ({
        cluster_id: m.cluster_id,
        growth_rate: `${(m.growth_rate * 100).toFixed(1)}%`
      })),
      most_shrinking: shrinking.slice(0, 5).map(m => ({
        cluster_id: m.cluster_id,
        growth_rate: `${(m.growth_rate * 100).toFixed(1)}%`
      })),
      highest_churn: highChurn.slice(0, 5).map(m => ({
        cluster_id: m.cluster_id,
        churn_rate: `${(m.churn_rate * 100).toFixed(1)}%`
      })),
      most_drift: drifting.slice(0, 5).map(m => ({
        cluster_id: m.cluster_id,
        centroid_drift: `${(m.centroid_drift * 100).toFixed(1)}%`
      }))
    },
    metrics: metrics
  };

  // Save report
  const outputDir = join(dirname(dirname(dirname(__dirname))), 'outputs', 'clustering', 'evolution');
  await fs.mkdir(outputDir, { recursive: true });
  
  const reportFile = join(outputDir, `evolution_report_${reportDate}.json`);
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));

  return report;
}

/**
 * Main execution function
 */
async function main() {
  console.log('Starting cluster evolution tracking...\n');

  try {
    // Ensure tables exist
    await ensureEvolutionTables();

    // Get all active clusters
    const { data: clusters, error } = await supabase
      .from('bertopic_clusters')
      .select('cluster_id')
      .order('cluster_id');

    if (error) {
      throw new Error(`Failed to fetch clusters: ${error.message}`);
    }

    console.log(`Tracking evolution for ${clusters.length} clusters...\n`);

    // Take snapshots
    console.log('Taking cluster snapshots...');
    let snapshotCount = 0;
    
    for (const cluster of clusters) {
      const snapshot = await takeClusterSnapshot(cluster.cluster_id);
      if (snapshot) {
        snapshotCount++;
      }
    }
    
    console.log(`Created ${snapshotCount} snapshots\n`);

    // Track transitions
    console.log('Tracking video transitions...');
    const transitions = await trackTransitions();
    console.log(`Found ${transitions.length} video transitions\n`);

    // Calculate evolution metrics
    console.log('Calculating evolution metrics...');
    let metricsCount = 0;
    
    for (const cluster of clusters) {
      const metrics = await calculateEvolutionMetrics(cluster.cluster_id);
      
      if (metrics) {
        const { error: insertError } = await supabase
          .from('cluster_evolution_metrics')
          .upsert(metrics, { onConflict: 'cluster_id,metric_date' });

        if (!insertError) {
          metricsCount++;
        }
      }
    }
    
    console.log(`Calculated metrics for ${metricsCount} clusters\n`);

    // Generate report
    console.log('Generating evolution report...');
    const report = await generateEvolutionReport();
    
    if (report) {
      console.log('\n=== Evolution Tracking Complete ===');
      console.log(`Clusters tracked: ${report.summary.total_clusters_tracked}`);
      console.log(`Fast growing: ${report.summary.fast_growing}`);
      console.log(`Shrinking: ${report.summary.shrinking}`);
      console.log(`High churn: ${report.summary.high_churn}`);
      console.log(`Drifting: ${report.summary.drifting}`);
      console.log(`Unstable: ${report.summary.unstable}`);
    }

  } catch (error) {
    console.error('Error during evolution tracking:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { takeClusterSnapshot, trackTransitions, calculateEvolutionMetrics };