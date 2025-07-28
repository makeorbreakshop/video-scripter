import { analyzeClusterCoverage } from './analyze-cluster-coverage.js';
import { generateClusterQueries } from './generate-cluster-queries.js';
import { trackDiscoveryEffectiveness } from './track-discovery-effectiveness.js';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Orchestrate discovery integration with clustering insights
 */
async function orchestrateDiscoveryIntegration(options = {}) {
  const {
    runCoverageAnalysis = true,
    generateQueries = true,
    trackEffectiveness = true,
    updatePriorities = true,
    maxQueries = 100
  } = options;

  console.log('🚀 Starting Discovery-Clustering Integration...\n');

  try {
    let coverageReport = null;
    let effectivenessReport = null;
    let generatedQueries = null;

    // Step 1: Analyze cluster coverage
    if (runCoverageAnalysis) {
      console.log('📊 Step 1: Analyzing cluster coverage...');
      coverageReport = await analyzeClusterCoverage();
      console.log('✅ Coverage analysis complete\n');
    }

    // Step 2: Track discovery effectiveness
    if (trackEffectiveness) {
      console.log('📈 Step 2: Tracking discovery effectiveness...');
      effectivenessReport = await trackDiscoveryEffectiveness({
        daysToAnalyze: 30,
        minVideosPerCluster: 5
      });
      console.log('✅ Effectiveness tracking complete\n');
    }

    // Step 3: Generate targeted queries
    if (generateQueries && coverageReport) {
      console.log('🔍 Step 3: Generating cluster-aware queries...');
      
      // Determine priority clusters based on coverage and effectiveness
      const priorityClusters = determinePriorityClusters(
        coverageReport,
        effectivenessReport
      );

      generatedQueries = await generateClusterQueries({
        maxQueries,
        prioritizeClusters: priorityClusters,
        includeGrowingClusters: true,
        includeUnderrepresented: true
      });

      console.log('✅ Query generation complete\n');
    }

    // Step 4: Update discovery priorities
    if (updatePriorities && coverageReport) {
      console.log('🎯 Step 4: Updating discovery priorities...');
      await updateDiscoveryPriorities(coverageReport, effectivenessReport);
      console.log('✅ Priority update complete\n');
    }

    // Step 5: Create integration report
    const integrationReport = {
      timestamp: new Date().toISOString(),
      coverage_summary: coverageReport?.summary || null,
      effectiveness_summary: effectivenessReport?.summary || null,
      queries_generated: generatedQueries?.length || 0,
      priority_clusters: determinePriorityClusters(coverageReport, effectivenessReport),
      recommendations: mergeRecommendations(
        coverageReport?.recommendations || [],
        effectivenessReport?.recommendations || []
      ),
      next_actions: generateNextActions(coverageReport, effectivenessReport, generatedQueries)
    };

    // Save integration report
    const outputDir = path.join(process.cwd(), 'outputs', 'clustering');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const reportPath = path.join(
      outputDir,
      `discovery_integration_${new Date().toISOString().split('T')[0]}.json`
    );
    fs.writeFileSync(reportPath, JSON.stringify(integrationReport, null, 2));

    // Create CSV export of queries for easy use
    if (generatedQueries && generatedQueries.length > 0) {
      const csvPath = path.join(
        outputDir,
        `discovery_queries_${new Date().toISOString().split('T')[0]}.csv`
      );
      const csvContent = createQueryCSV(generatedQueries);
      fs.writeFileSync(csvPath, csvContent);
      console.log(`📄 Query CSV exported to: ${csvPath}`);
    }

    // Print summary
    console.log('\n🎊 Discovery Integration Complete!');
    console.log('\n📊 Summary:');
    console.log(`   Cluster Coverage: ${coverageReport?.summary.coverage_rate || 'N/A'}`);
    console.log(`   Priority Clusters: ${integrationReport.priority_clusters.length}`);
    console.log(`   Queries Generated: ${integrationReport.queries_generated}`);
    
    console.log('\n🎯 Top Priority Actions:');
    integrationReport.next_actions.slice(0, 5).forEach((action, idx) => {
      console.log(`   ${idx + 1}. ${action.action}`);
      console.log(`      Priority: ${action.priority}`);
      console.log(`      Impact: ${action.expected_impact}`);
    });

    console.log(`\n✅ Full report saved to: ${reportPath}`);

    return integrationReport;

  } catch (error) {
    console.error('❌ Error in discovery integration:', error);
    throw error;
  }
}

function determinePriorityClusters(coverageReport, effectivenessReport) {
  const priorityClusters = new Set();

  if (coverageReport) {
    // Add fast-growing underrepresented clusters
    coverageReport.fastest_growing_clusters
      .filter(c => coverageReport.underrepresented_clusters.some(u => u.cluster_id === c.cluster_id))
      .slice(0, 10)
      .forEach(c => priorityClusters.add(c.cluster_id));

    // Add high-value underrepresented clusters
    coverageReport.underrepresented_clusters
      .filter(c => c.avg_views > 10000)
      .slice(0, 10)
      .forEach(c => priorityClusters.add(c.cluster_id));
  }

  if (effectivenessReport) {
    // Add clusters with high discovery effectiveness
    effectivenessReport.cluster_effectiveness
      .filter(c => c.avg_views > 20000 && c.channel_diversity > 0.5)
      .slice(0, 10)
      .forEach(c => priorityClusters.add(c.cluster_id));
  }

  return Array.from(priorityClusters);
}

async function updateDiscoveryPriorities(coverageReport, effectivenessReport) {
  // Create priority scores for each cluster
  const clusterPriorities = new Map();

  // Base priorities from coverage
  if (coverageReport) {
    coverageReport.underrepresented_clusters.forEach(cluster => {
      clusterPriorities.set(cluster.cluster_id, {
        cluster_id: cluster.cluster_id,
        base_score: 50 + (cluster.avg_views > 10000 ? 20 : 0),
        is_underrepresented: true,
        is_growing: false,
        effectiveness_score: 0
      });
    });

    coverageReport.fastest_growing_clusters.forEach(cluster => {
      const existing = clusterPriorities.get(cluster.cluster_id) || {
        cluster_id: cluster.cluster_id,
        base_score: 30,
        is_underrepresented: false,
        effectiveness_score: 0
      };
      existing.is_growing = true;
      existing.base_score += 30;
      clusterPriorities.set(cluster.cluster_id, existing);
    });
  }

  // Add effectiveness scores
  if (effectivenessReport) {
    effectivenessReport.cluster_effectiveness.forEach(cluster => {
      const existing = clusterPriorities.get(cluster.cluster_id) || {
        cluster_id: cluster.cluster_id,
        base_score: 0,
        is_underrepresented: false,
        is_growing: false
      };
      
      // Calculate effectiveness score
      let effScore = 0;
      if (cluster.avg_views > 50000) effScore += 40;
      else if (cluster.avg_views > 20000) effScore += 30;
      else if (cluster.avg_views > 10000) effScore += 20;
      
      effScore += parseFloat(cluster.channel_diversity) * 30;
      
      existing.effectiveness_score = effScore;
      existing.base_score += effScore * 0.5; // Weight effectiveness at 50%
      
      clusterPriorities.set(cluster.cluster_id, existing);
    });
  }

  // Store priorities in database
  const priorityRecords = Array.from(clusterPriorities.values()).map(p => ({
    cluster_id: p.cluster_id,
    priority_score: Math.round(p.base_score),
    is_underrepresented: p.is_underrepresented,
    is_growing: p.is_growing,
    effectiveness_score: Math.round(p.effectiveness_score),
    updated_at: new Date().toISOString()
  }));

  // Create or update cluster_discovery_priorities table
  const { error: createError } = await supabase.rpc('create_cluster_discovery_priorities_if_not_exists');
  
  if (!createError) {
    // Upsert priorities
    const { error: upsertError } = await supabase
      .from('cluster_discovery_priorities')
      .upsert(priorityRecords, { onConflict: 'cluster_id' });

    if (upsertError) {
      console.error('Error updating priorities:', upsertError);
    } else {
      console.log(`Updated priorities for ${priorityRecords.length} clusters`);
    }
  }
}

function mergeRecommendations(coverageRecs, effectivenessRecs) {
  const merged = [...coverageRecs];
  
  // Add effectiveness recommendations that aren't duplicates
  effectivenessRecs.forEach(effRec => {
    const isDuplicate = merged.some(rec => 
      rec.type === effRec.type && 
      JSON.stringify(rec.clusters) === JSON.stringify(effRec.clusters)
    );
    
    if (!isDuplicate) {
      merged.push(effRec);
    }
  });

  // Sort by priority
  const priorityOrder = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1, 'INFO': 0 };
  merged.sort((a, b) => 
    (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0)
  );

  return merged;
}

function generateNextActions(coverageReport, effectivenessReport, queries) {
  const actions = [];

  // High-priority actions based on coverage gaps
  if (coverageReport?.underrepresented_clusters.length > 50) {
    actions.push({
      action: 'Run focused discovery on underrepresented clusters',
      priority: 'HIGH',
      expected_impact: `Fill gaps in ${coverageReport.underrepresented_clusters.length} clusters`,
      clusters_affected: coverageReport.underrepresented_clusters.slice(0, 20).map(c => c.cluster_id)
    });
  }

  // Actions based on growth trends
  if (coverageReport?.fastest_growing_clusters.length > 0) {
    actions.push({
      action: 'Increase discovery for trending topics',
      priority: 'HIGH',
      expected_impact: 'Capture emerging content trends',
      clusters_affected: coverageReport.fastest_growing_clusters.slice(0, 10).map(c => c.cluster_id)
    });
  }

  // Actions based on effectiveness
  if (effectivenessReport?.recommendations) {
    const diversifyRec = effectivenessReport.recommendations.find(r => r.type === 'diversify_sources');
    if (diversifyRec) {
      actions.push({
        action: 'Diversify discovery sources for single-source clusters',
        priority: 'MEDIUM',
        expected_impact: `Improve channel diversity in ${diversifyRec.clusters.length} clusters`,
        clusters_affected: diversifyRec.clusters.map(c => c.cluster_id)
      });
    }
  }

  // Query execution action
  if (queries && queries.length > 0) {
    actions.push({
      action: `Execute ${queries.length} cluster-targeted search queries`,
      priority: 'HIGH',
      expected_impact: 'Discover channels in priority clusters',
      query_count: queries.length
    });
  }

  // Clustering refresh action
  const daysSinceLastClustering = 7; // TODO: Calculate from actual data
  if (daysSinceLastClustering > 14) {
    actions.push({
      action: 'Run full HDBSCAN re-clustering',
      priority: 'MEDIUM',
      expected_impact: 'Update cluster assignments for new videos',
      videos_affected: 'All videos with embeddings'
    });
  }

  return actions.sort((a, b) => {
    const priorityOrder = { 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
    return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
  });
}

function createQueryCSV(queries) {
  const headers = ['query', 'cluster_id', 'cluster_name', 'priority_score', 'is_growing', 'is_underrepresented'];
  const rows = [headers.join(',')];

  queries.forEach(q => {
    const row = [
      `"${q.query.replace(/"/g, '""')}"`,
      q.cluster_id || '',
      q.metadata?.cluster_name ? `"${q.metadata.cluster_name.replace(/"/g, '""')}"` : '',
      q.priority_score || 0,
      q.metadata?.is_growing || false,
      q.metadata?.is_underrepresented || false
    ];
    rows.push(row.join(','));
  });

  return rows.join('\n');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  orchestrateDiscoveryIntegration()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { orchestrateDiscoveryIntegration };