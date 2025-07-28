import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Track discovery effectiveness by cluster
 */
async function trackDiscoveryEffectiveness(options = {}) {
  const {
    daysToAnalyze = 30,
    minVideosPerCluster = 10
  } = options;

  console.log('📊 Tracking discovery effectiveness by cluster...\n');

  try {
    // Get recently discovered videos
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToAnalyze);

    const { data: recentVideos, error: videoError } = await supabase
      .from('videos')
      .select('id, title, channel_id, published_at, view_count, import_date')
      .gte('import_date', cutoffDate.toISOString())
      .not('title_embedding', 'is', null)
      .order('import_date', { ascending: false });

    if (videoError) throw videoError;

    console.log(`Found ${recentVideos.length} videos imported in last ${daysToAnalyze} days`);

    // Get their cluster assignments
    const videoIds = recentVideos.map(v => v.id);
    const { data: clusterAssignments, error: clusterError } = await supabase
      .from('video_hdbscan_clusters')
      .select('video_id, cluster_id, probability')
      .in('video_id', videoIds);

    if (clusterError) throw clusterError;

    // Get discovery sources
    const { data: discoverySources, error: sourceError } = await supabase
      .from('discovered_channels')
      .select('channel_id, discovery_source, search_query, discovered_at')
      .gte('discovered_at', cutoffDate.toISOString());

    if (sourceError) throw sourceError;

    // Create lookup maps
    const videoToCluster = new Map();
    clusterAssignments.forEach(ca => {
      videoToCluster.set(ca.video_id, {
        cluster_id: ca.cluster_id,
        probability: ca.probability
      });
    });

    const channelToSource = new Map();
    discoverySources.forEach(ds => {
      channelToSource.set(ds.channel_id, {
        source: ds.discovery_source,
        query: ds.search_query,
        discovered_at: ds.discovered_at
      });
    });

    // Analyze effectiveness by cluster
    const clusterStats = new Map();
    
    recentVideos.forEach(video => {
      const clusterInfo = videoToCluster.get(video.id);
      if (!clusterInfo || clusterInfo.cluster_id === -1) return; // Skip noise

      const clusterId = clusterInfo.cluster_id;
      if (!clusterStats.has(clusterId)) {
        clusterStats.set(clusterId, {
          cluster_id: clusterId,
          total_videos: 0,
          total_views: 0,
          channels: new Set(),
          sources: new Map(),
          queries: new Map(),
          high_confidence_videos: 0,
          avg_probability: 0,
          probability_sum: 0
        });
      }

      const stats = clusterStats.get(clusterId);
      stats.total_videos++;
      stats.total_views += video.view_count || 0;
      stats.channels.add(video.channel_id);
      stats.probability_sum += clusterInfo.probability;
      
      if (clusterInfo.probability > 0.8) {
        stats.high_confidence_videos++;
      }

      // Track discovery source
      const source = channelToSource.get(video.channel_id);
      if (source) {
        // Track by source type
        const sourceCount = stats.sources.get(source.source) || 0;
        stats.sources.set(source.source, sourceCount + 1);
        
        // Track by query
        if (source.query) {
          const queryCount = stats.queries.get(source.query) || 0;
          stats.queries.set(source.query, queryCount + 1);
        }
      }
    });

    // Calculate final metrics
    const clusterMetrics = [];
    for (const [clusterId, stats] of clusterStats) {
      if (stats.total_videos < minVideosPerCluster) continue;

      stats.avg_probability = stats.probability_sum / stats.total_videos;
      stats.avg_views = stats.total_views / stats.total_videos;
      stats.channel_diversity = stats.channels.size / stats.total_videos;
      
      // Convert sets and maps to arrays for JSON
      const metrics = {
        cluster_id: clusterId,
        total_videos: stats.total_videos,
        total_views: stats.total_views,
        avg_views: Math.round(stats.avg_views),
        unique_channels: stats.channels.size,
        channel_diversity: stats.channel_diversity.toFixed(3),
        high_confidence_rate: (stats.high_confidence_videos / stats.total_videos).toFixed(3),
        avg_cluster_probability: stats.avg_probability.toFixed(3),
        top_sources: Array.from(stats.sources.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([source, count]) => ({ source, count })),
        top_queries: Array.from(stats.queries.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([query, count]) => ({ query, count }))
      };

      clusterMetrics.push(metrics);
    }

    // Sort by total videos discovered
    clusterMetrics.sort((a, b) => b.total_videos - a.total_videos);

    // Load cluster names
    const clusterIds = clusterMetrics.map(m => m.cluster_id);
    const { data: clusterNames } = await supabase
      .from('cluster_metadata')
      .select('cluster_id, name')
      .in('cluster_id', clusterIds);

    const clusterNameMap = new Map();
    clusterNames?.forEach(cn => {
      clusterNameMap.set(cn.cluster_id, cn.name);
    });

    // Add cluster names to metrics
    clusterMetrics.forEach(metric => {
      metric.cluster_name = clusterNameMap.get(metric.cluster_id) || `Cluster ${metric.cluster_id}`;
    });

    // Generate effectiveness scores
    const effectivenessReport = {
      analysis_period: {
        days: daysToAnalyze,
        start_date: cutoffDate.toISOString(),
        end_date: new Date().toISOString()
      },
      summary: {
        total_videos_discovered: recentVideos.length,
        clusters_with_discoveries: clusterMetrics.length,
        avg_videos_per_cluster: Math.round(recentVideos.length / clusterMetrics.length),
        total_unique_channels: new Set(recentVideos.map(v => v.channel_id)).size
      },
      cluster_effectiveness: clusterMetrics,
      recommendations: generateRecommendations(clusterMetrics)
    };

    // Save report
    const outputDir = path.join(process.cwd(), 'outputs', 'clustering');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const reportPath = path.join(
      outputDir, 
      `discovery_effectiveness_${new Date().toISOString().split('T')[0]}.json`
    );
    fs.writeFileSync(reportPath, JSON.stringify(effectivenessReport, null, 2));

    // Print summary
    console.log('\n📈 Discovery Effectiveness Summary:');
    console.log(`   Analysis Period: ${daysToAnalyze} days`);
    console.log(`   Total Videos: ${effectivenessReport.summary.total_videos_discovered}`);
    console.log(`   Clusters Reached: ${effectivenessReport.summary.clusters_with_discoveries}`);
    console.log(`   Unique Channels: ${effectivenessReport.summary.total_unique_channels}`);
    
    console.log('\n🎯 Top Discovered Clusters:');
    clusterMetrics.slice(0, 5).forEach(cluster => {
      console.log(`   - ${cluster.cluster_name}: ${cluster.total_videos} videos`);
      console.log(`     Avg Views: ${cluster.avg_views.toLocaleString()}`);
      console.log(`     Channel Diversity: ${cluster.channel_diversity}`);
      console.log(`     Top Source: ${cluster.top_sources[0]?.source || 'Unknown'}`);
    });

    console.log(`\n✅ Report saved to: ${reportPath}`);
    
    return effectivenessReport;

  } catch (error) {
    console.error('❌ Error tracking discovery effectiveness:', error);
    throw error;
  }
}

function generateRecommendations(clusterMetrics) {
  const recommendations = [];

  // Find clusters with high effectiveness
  const highPerformers = clusterMetrics.filter(c => 
    c.avg_views > 10000 && c.channel_diversity > 0.5
  );
  
  if (highPerformers.length > 0) {
    recommendations.push({
      type: 'expand_successful',
      priority: 'HIGH',
      message: `${highPerformers.length} clusters show high discovery effectiveness`,
      clusters: highPerformers.slice(0, 10).map(c => ({
        cluster_id: c.cluster_id,
        name: c.cluster_name,
        effectiveness_score: calculateEffectivenessScore(c)
      }))
    });
  }

  // Find clusters with single-source dominance
  const singleSourceClusters = clusterMetrics.filter(c => {
    const topSource = c.top_sources[0];
    return topSource && (topSource.count / c.total_videos) > 0.7;
  });

  if (singleSourceClusters.length > 0) {
    recommendations.push({
      type: 'diversify_sources',
      priority: 'MEDIUM',
      message: `${singleSourceClusters.length} clusters rely heavily on single discovery source`,
      clusters: singleSourceClusters.slice(0, 5).map(c => ({
        cluster_id: c.cluster_id,
        name: c.cluster_name,
        dominant_source: c.top_sources[0].source
      }))
    });
  }

  // Find clusters with low channel diversity
  const lowDiversityClusters = clusterMetrics.filter(c => 
    c.channel_diversity < 0.3 && c.total_videos > 20
  );

  if (lowDiversityClusters.length > 0) {
    recommendations.push({
      type: 'increase_diversity',
      priority: 'MEDIUM',
      message: `${lowDiversityClusters.length} clusters have low channel diversity`,
      clusters: lowDiversityClusters.slice(0, 5).map(c => ({
        cluster_id: c.cluster_id,
        name: c.cluster_name,
        diversity_score: c.channel_diversity
      }))
    });
  }

  // Identify effective queries
  const effectiveQueries = new Map();
  clusterMetrics.forEach(cluster => {
    cluster.top_queries.forEach(q => {
      if (!effectiveQueries.has(q.query)) {
        effectiveQueries.set(q.query, {
          query: q.query,
          total_videos: 0,
          clusters_reached: []
        });
      }
      const queryStats = effectiveQueries.get(q.query);
      queryStats.total_videos += q.count;
      queryStats.clusters_reached.push(cluster.cluster_id);
    });
  });

  const topQueries = Array.from(effectiveQueries.entries())
    .sort((a, b) => b[1].total_videos - a[1].total_videos)
    .slice(0, 10);

  if (topQueries.length > 0) {
    recommendations.push({
      type: 'effective_queries',
      priority: 'INFO',
      message: 'Most effective discovery queries',
      queries: topQueries.map(([query, stats]) => ({
        query,
        total_videos: stats.total_videos,
        cluster_diversity: stats.clusters_reached.length
      }))
    });
  }

  return recommendations;
}

function calculateEffectivenessScore(clusterMetric) {
  let score = 0;
  
  // View performance (0-40 points)
  if (clusterMetric.avg_views > 50000) score += 40;
  else if (clusterMetric.avg_views > 20000) score += 30;
  else if (clusterMetric.avg_views > 10000) score += 20;
  else if (clusterMetric.avg_views > 5000) score += 10;
  
  // Channel diversity (0-30 points)
  score += clusterMetric.channel_diversity * 30;
  
  // Cluster confidence (0-20 points)
  score += parseFloat(clusterMetric.high_confidence_rate) * 20;
  
  // Volume bonus (0-10 points)
  if (clusterMetric.total_videos > 100) score += 10;
  else if (clusterMetric.total_videos > 50) score += 5;
  
  return Math.round(score);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  trackDiscoveryEffectiveness()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { trackDiscoveryEffectiveness };