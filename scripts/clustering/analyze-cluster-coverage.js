import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Analyze cluster coverage and identify gaps
 */
async function analyzeClusterCoverage() {
  console.log('🔍 Analyzing cluster coverage and gaps...\n');

  try {
    // Get cluster statistics
    const { data: clusterStats, error: statsError } = await supabase
      .from('hdbscan_cluster_metadata')
      .select('*')
      .order('cluster_size', { ascending: false });

    if (statsError) throw statsError;

    // Get total video count
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('title_embedding', 'is', null);

    // Get videos per cluster
    const { data: clusterDistribution, error: distError } = await supabase
      .from('video_hdbscan_clusters')
      .select('cluster_id')
      .neq('cluster_id', -1); // Exclude noise

    if (distError) throw distError;

    // Calculate coverage metrics
    const clusteredVideos = clusterDistribution.length;
    const coverageRate = (clusteredVideos / totalVideos) * 100;
    
    // Group by cluster size
    const clusterSizes = {};
    clusterDistribution.forEach(v => {
      clusterSizes[v.cluster_id] = (clusterSizes[v.cluster_id] || 0) + 1;
    });

    // Identify clusters by coverage
    const underrepresented = [];
    const wellRepresented = [];
    const overrepresented = [];
    
    const avgClusterSize = clusteredVideos / Object.keys(clusterSizes).length;

    clusterStats.forEach(cluster => {
      const size = clusterSizes[cluster.cluster_id] || 0;
      const ratio = size / avgClusterSize;
      
      const clusterInfo = {
        cluster_id: cluster.cluster_id,
        name: cluster.cluster_name || `Cluster ${cluster.cluster_id}`,
        size: size,
        ratio: ratio,
        avg_views: cluster.avg_views || 0,
        sample_titles: cluster.top_titles?.slice(0, 3) || []
      };

      if (ratio < 0.5) {
        underrepresented.push(clusterInfo);
      } else if (ratio > 2.0) {
        overrepresented.push(clusterInfo);
      } else {
        wellRepresented.push(clusterInfo);
      }
    });

    // Get growth trends
    const { data: recentVideos, error: recentError } = await supabase
      .from('videos')
      .select('id, published_at')
      .gte('published_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .not('title_embedding', 'is', null);

    if (recentError) throw recentError;

    // Get their cluster assignments
    const recentVideoIds = recentVideos.map(v => v.id);
    const { data: recentClusters, error: recentClusterError } = await supabase
      .from('video_hdbscan_clusters')
      .select('video_id, cluster_id')
      .in('video_id', recentVideoIds);

    if (recentClusterError) throw recentClusterError;

    // Calculate growth by cluster
    const growthByCluster = {};
    recentClusters.forEach(vc => {
      growthByCluster[vc.cluster_id] = (growthByCluster[vc.cluster_id] || 0) + 1;
    });

    // Sort clusters by growth
    const growingClusters = Object.entries(growthByCluster)
      .map(([cluster_id, count]) => ({
        cluster_id: parseInt(cluster_id),
        growth_count: count,
        growth_rate: count / (clusterSizes[cluster_id] || 1)
      }))
      .sort((a, b) => b.growth_rate - a.growth_rate)
      .slice(0, 20);

    // Generate report
    const report = {
      summary: {
        total_videos: totalVideos,
        clustered_videos: clusteredVideos,
        coverage_rate: coverageRate.toFixed(2) + '%',
        total_clusters: Object.keys(clusterSizes).length,
        avg_cluster_size: Math.round(avgClusterSize),
        underrepresented_clusters: underrepresented.length,
        overrepresented_clusters: overrepresented.length
      },
      underrepresented_clusters: underrepresented.slice(0, 30),
      overrepresented_clusters: overrepresented.slice(0, 10),
      fastest_growing_clusters: growingClusters,
      recommendations: generateRecommendations(underrepresented, growingClusters, clusterStats)
    };

    // Save report
    const outputDir = path.join(process.cwd(), 'outputs', 'clustering');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const reportPath = path.join(outputDir, `cluster_coverage_${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Print summary
    console.log('📊 Cluster Coverage Analysis:');
    console.log(`   Total Videos: ${report.summary.total_videos.toLocaleString()}`);
    console.log(`   Clustered: ${report.summary.clustered_videos.toLocaleString()} (${report.summary.coverage_rate})`);
    console.log(`   Total Clusters: ${report.summary.total_clusters}`);
    console.log(`   Average Cluster Size: ${report.summary.avg_cluster_size}`);
    console.log(`\n   Underrepresented: ${report.summary.underrepresented_clusters} clusters`);
    console.log(`   Overrepresented: ${report.summary.overrepresented_clusters} clusters`);
    
    console.log('\n🚀 Top Growing Clusters:');
    report.fastest_growing_clusters.slice(0, 5).forEach(cluster => {
      const metadata = clusterStats.find(c => c.cluster_id === cluster.cluster_id);
      console.log(`   - ${metadata?.cluster_name || `Cluster ${cluster.cluster_id}`}: +${cluster.growth_count} videos (${(cluster.growth_rate * 100).toFixed(1)}% growth)`);
    });

    console.log(`\n✅ Report saved to: ${reportPath}`);
    
    return report;

  } catch (error) {
    console.error('❌ Error analyzing cluster coverage:', error);
    throw error;
  }
}

function generateRecommendations(underrepresented, growingClusters, clusterStats) {
  const recommendations = [];

  // Priority 1: Fast-growing but underrepresented clusters
  const growingClusterIds = new Set(growingClusters.map(c => c.cluster_id));
  const highPriority = underrepresented.filter(c => growingClusterIds.has(c.cluster_id));
  
  if (highPriority.length > 0) {
    recommendations.push({
      priority: 'HIGH',
      type: 'trending_gaps',
      message: `${highPriority.length} clusters are both fast-growing and underrepresented`,
      clusters: highPriority.slice(0, 10).map(c => c.cluster_id)
    });
  }

  // Priority 2: High-performing underrepresented clusters
  const highPerforming = underrepresented
    .filter(c => c.avg_views > 10000)
    .sort((a, b) => b.avg_views - a.avg_views);
  
  if (highPerforming.length > 0) {
    recommendations.push({
      priority: 'HIGH',
      type: 'high_value_gaps',
      message: `${highPerforming.length} underrepresented clusters have high average views`,
      clusters: highPerforming.slice(0, 10).map(c => c.cluster_id)
    });
  }

  // Priority 3: General underrepresented clusters
  recommendations.push({
    priority: 'MEDIUM',
    type: 'coverage_gaps',
    message: `${underrepresented.length} clusters need more content`,
    clusters: underrepresented.slice(0, 20).map(c => c.cluster_id)
  });

  // Priority 4: Overrepresented clusters to deprioritize
  const overrepresented = clusterStats
    .filter(c => (clusterSizes[c.cluster_id] || 0) > avgClusterSize * 3)
    .map(c => c.cluster_id);

  if (overrepresented.length > 0) {
    recommendations.push({
      priority: 'LOW',
      type: 'deprioritize',
      message: `${overrepresented.length} clusters are overrepresented and should be deprioritized`,
      clusters: overrepresented.slice(0, 10)
    });
  }

  return recommendations;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  analyzeClusterCoverage()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { analyzeClusterCoverage };