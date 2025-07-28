import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Generate targeted search queries based on cluster insights
 */
async function generateClusterQueries(options = {}) {
  const {
    maxQueries = 100,
    prioritizeClusters = [],
    includeGrowingClusters = true,
    includeUnderrepresented = true
  } = options;

  console.log('🔍 Generating cluster-based search queries...\n');

  try {
    // Load cluster metadata
    const { data: clusters, error: clusterError } = await supabase
      .from('cluster_metadata')
      .select('*')
      .order('cluster_id');

    if (clusterError) throw clusterError;

    // Load cluster coverage report if available
    const coverageReportPath = path.join(
      process.cwd(), 
      'outputs', 
      'clustering',
      `cluster_coverage_${new Date().toISOString().split('T')[0]}.json`
    );
    
    let coverageReport = null;
    if (fs.existsSync(coverageReportPath)) {
      coverageReport = JSON.parse(fs.readFileSync(coverageReportPath, 'utf-8'));
    }

    // Determine which clusters to generate queries for
    let targetClusters = [];

    // Add explicitly prioritized clusters
    if (prioritizeClusters.length > 0) {
      targetClusters.push(...clusters.filter(c => prioritizeClusters.includes(c.cluster_id)));
    }

    // Add growing clusters
    if (includeGrowingClusters && coverageReport) {
      const growingClusterIds = coverageReport.fastest_growing_clusters
        .slice(0, 20)
        .map(c => c.cluster_id);
      targetClusters.push(...clusters.filter(c => growingClusterIds.includes(c.cluster_id)));
    }

    // Add underrepresented clusters
    if (includeUnderrepresented && coverageReport) {
      const underrepresentedIds = coverageReport.underrepresented_clusters
        .slice(0, 30)
        .map(c => c.cluster_id);
      targetClusters.push(...clusters.filter(c => underrepresentedIds.includes(c.cluster_id)));
    }

    // Remove duplicates
    const uniqueClusterIds = new Set();
    targetClusters = targetClusters.filter(c => {
      if (uniqueClusterIds.has(c.cluster_id)) return false;
      uniqueClusterIds.add(c.cluster_id);
      return true;
    });

    // If no specific targets, use all clusters
    if (targetClusters.length === 0) {
      targetClusters = clusters;
    }

    // Generate queries for each cluster
    const queries = [];
    const queryTemplates = getQueryTemplates();

    for (const cluster of targetClusters) {
      const clusterQueries = generateQueriesForCluster(cluster, queryTemplates);
      queries.push(...clusterQueries);
      
      if (queries.length >= maxQueries) break;
    }

    // Trim to max queries
    const finalQueries = queries.slice(0, maxQueries);

    // Add metadata about why each query was generated
    const enrichedQueries = finalQueries.map(q => {
      const cluster = targetClusters.find(c => c.cluster_id === q.cluster_id);
      const isGrowing = coverageReport?.fastest_growing_clusters
        .some(gc => gc.cluster_id === q.cluster_id);
      const isUnderrepresented = coverageReport?.underrepresented_clusters
        .some(uc => uc.cluster_id === q.cluster_id);

      return {
        ...q,
        metadata: {
          cluster_name: cluster?.name || `Cluster ${q.cluster_id}`,
          is_growing: isGrowing || false,
          is_underrepresented: isUnderrepresented || false,
          cluster_size: cluster?.video_count || 0,
          priority_score: calculatePriorityScore(cluster, isGrowing, isUnderrepresented)
        }
      };
    });

    // Sort by priority
    enrichedQueries.sort((a, b) => b.metadata.priority_score - a.metadata.priority_score);

    // Save queries
    const outputDir = path.join(process.cwd(), 'outputs', 'clustering');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(outputDir, `cluster_queries_${timestamp}.json`);
    fs.writeFileSync(outputPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      total_queries: enrichedQueries.length,
      target_clusters: uniqueClusterIds.size,
      queries: enrichedQueries
    }, null, 2));

    // Print summary
    console.log('📊 Query Generation Summary:');
    console.log(`   Total Queries: ${enrichedQueries.length}`);
    console.log(`   Target Clusters: ${uniqueClusterIds.size}`);
    console.log(`   Growing Clusters: ${enrichedQueries.filter(q => q.metadata.is_growing).length}`);
    console.log(`   Underrepresented: ${enrichedQueries.filter(q => q.metadata.is_underrepresented).length}`);
    
    console.log('\n🎯 Top Priority Queries:');
    enrichedQueries.slice(0, 5).forEach(q => {
      console.log(`   - "${q.query}"`);
      console.log(`     Cluster: ${q.metadata.cluster_name}`);
      console.log(`     Priority: ${q.metadata.priority_score.toFixed(2)}`);
    });

    console.log(`\n✅ Queries saved to: ${outputPath}`);
    
    return enrichedQueries;

  } catch (error) {
    console.error('❌ Error generating cluster queries:', error);
    throw error;
  }
}

function generateQueriesForCluster(cluster, templates) {
  const queries = [];
  
  // Extract key terms from cluster
  const keywords = cluster.keywords || [];
  const searchTerms = cluster.search_terms || [];
  const subtopics = cluster.subtopics || [];
  
  // Combine all relevant terms
  const allTerms = [
    ...keywords.slice(0, 5),
    ...searchTerms.slice(0, 3),
    ...subtopics.slice(0, 3)
  ].filter(Boolean);

  // Generate queries using different templates
  for (const template of templates) {
    for (const term of allTerms.slice(0, 3)) { // Limit to avoid too many queries per cluster
      const query = template.replace('{topic}', term);
      queries.push({
        query,
        cluster_id: cluster.cluster_id,
        template_type: getTemplateType(template),
        source_term: term
      });
    }
  }

  // Add cluster name-based queries if available
  if (cluster.name) {
    queries.push({
      query: `${cluster.name} tutorial 2025`,
      cluster_id: cluster.cluster_id,
      template_type: 'direct',
      source_term: cluster.name
    });
    
    queries.push({
      query: `learn ${cluster.name} complete course`,
      cluster_id: cluster.cluster_id,
      template_type: 'course',
      source_term: cluster.name
    });
  }

  return queries.slice(0, 5); // Max 5 queries per cluster
}

function getQueryTemplates() {
  return [
    '{topic} tutorial for beginners',
    '{topic} complete course 2025',
    'how to {topic} step by step',
    '{topic} masterclass free',
    'learn {topic} from experts',
    '{topic} workshop recording',
    '{topic} explained simply',
    'best {topic} youtube channels'
  ];
}

function getTemplateType(template) {
  if (template.includes('course') || template.includes('masterclass')) return 'course';
  if (template.includes('tutorial') || template.includes('how to')) return 'tutorial';
  if (template.includes('workshop') || template.includes('explained')) return 'educational';
  if (template.includes('channels')) return 'discovery';
  return 'general';
}

function calculatePriorityScore(cluster, isGrowing, isUnderrepresented) {
  let score = 0;
  
  // Base score from cluster size (inverse - smaller clusters get higher priority)
  const size = cluster?.video_count || 0;
  if (size < 100) score += 30;
  else if (size < 500) score += 20;
  else if (size < 1000) score += 10;
  
  // Growing clusters get bonus
  if (isGrowing) score += 25;
  
  // Underrepresented clusters get bonus
  if (isUnderrepresented) score += 20;
  
  // High-value clusters (based on average views) get bonus
  const avgViews = cluster?.avg_views || 0;
  if (avgViews > 50000) score += 15;
  else if (avgViews > 10000) score += 10;
  else if (avgViews > 5000) score += 5;
  
  // Educational level diversity bonus
  const level = cluster?.level || '';
  if (level === 'intermediate' || level === 'advanced') score += 5;
  
  return score;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  generateClusterQueries()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { generateClusterQueries };