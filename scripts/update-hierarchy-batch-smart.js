#!/usr/bin/env node

/**
 * Smart batch update script for BERTopic hierarchy
 * Updates videos table with proper 3-level hierarchy
 * Handles Supabase timeouts by processing in small batches
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Load hierarchy mapping
async function loadHierarchyMapping() {
  const mappingPath = path.join(__dirname, '../data/bertopic/better_topic_names_v3_proper_hierarchy.json');
  const content = await fs.readFile(mappingPath, 'utf-8');
  const data = JSON.parse(content);
  return data.topics;
}

// Get distinct cluster IDs that need updating
async function getClusterIds() {
  const { data, error } = await supabase
    .from('videos')
    .select('topic_cluster_id')
    .not('topic_cluster_id', 'is', null)
    .order('topic_cluster_id');
  
  if (error) throw error;
  
  // Get unique cluster IDs
  const uniqueClusters = [...new Set(data.map(v => v.topic_cluster_id))];
  return uniqueClusters.sort((a, b) => a - b);
}

// Update a single cluster
async function updateCluster(clusterId, mapping) {
  const clusterMapping = mapping[clusterId.toString()];
  if (!clusterMapping) {
    console.log(`⚠️  No mapping found for cluster ${clusterId}`);
    return { updated: 0, skipped: 1 };
  }

  const startTime = Date.now();
  
  try {
    // Use RPC to execute update with timeout handling
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        UPDATE videos 
        SET 
          topic_domain = $1,
          topic_niche = $2,
          topic_micro = $3,
          updated_at = NOW()
        WHERE topic_cluster_id = $4
      `,
      params: [
        clusterMapping.category,
        clusterMapping.subcategory,
        clusterMapping.name,
        clusterId
      ]
    });

    if (error) {
      // If exec_sql doesn't exist, fall back to direct update
      if (error.message.includes('function') || error.message.includes('does not exist')) {
        const { error: updateError } = await supabase
          .from('videos')
          .update({
            topic_domain: clusterMapping.category,
            topic_niche: clusterMapping.subcategory,
            topic_micro: clusterMapping.name,
            updated_at: new Date().toISOString()
          })
          .eq('topic_cluster_id', clusterId);

        if (updateError) throw updateError;
      } else {
        throw error;
      }
    }

    // Get count of updated rows
    const { count } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('topic_cluster_id', clusterId)
      .eq('topic_domain', clusterMapping.category)
      .eq('topic_niche', clusterMapping.subcategory)
      .eq('topic_micro', clusterMapping.name);

    const duration = Date.now() - startTime;
    console.log(`✅ Cluster ${clusterId}: Updated ${count} videos in ${duration}ms`);
    
    return { updated: count || 0, skipped: 0 };
  } catch (error) {
    console.error(`❌ Cluster ${clusterId}: ${error.message}`);
    return { updated: 0, skipped: 1, error: error.message };
  }
}

// Progress tracking
function saveProgress(progress) {
  const progressPath = path.join(__dirname, '../data/hierarchy-update-progress.json');
  fs.writeFile(progressPath, JSON.stringify(progress, null, 2));
}

async function loadProgress() {
  const progressPath = path.join(__dirname, '../data/hierarchy-update-progress.json');
  try {
    const content = await fs.readFile(progressPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { completedClusters: [], stats: { totalUpdated: 0, totalSkipped: 0 } };
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting BERTopic hierarchy update...\n');

  try {
    // Load mapping and progress
    const mapping = await loadHierarchyMapping();
    const progress = await loadProgress();
    
    // Get all cluster IDs
    const allClusters = await getClusterIds();
    console.log(`📊 Found ${allClusters.length} unique clusters\n`);

    // Filter out already completed clusters
    const remainingClusters = allClusters.filter(
      id => !progress.completedClusters.includes(id)
    );
    
    if (remainingClusters.length === 0) {
      console.log('✅ All clusters have been updated!');
      return;
    }

    console.log(`📝 ${remainingClusters.length} clusters remaining\n`);

    // Process clusters one by one
    let stats = progress.stats;
    
    for (let i = 0; i < remainingClusters.length; i++) {
      const clusterId = remainingClusters[i];
      console.log(`\n[${i + 1}/${remainingClusters.length}] Processing cluster ${clusterId}...`);
      
      const result = await updateCluster(clusterId, mapping);
      
      stats.totalUpdated += result.updated;
      stats.totalSkipped += result.skipped;
      
      // Mark as completed
      progress.completedClusters.push(clusterId);
      progress.stats = stats;
      
      // Save progress after each cluster
      await saveProgress(progress);
      
      // Small delay to avoid rate limiting
      if (i < remainingClusters.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Final summary
    console.log('\n' + '='.repeat(50));
    console.log('✅ Update completed!');
    console.log(`📊 Total videos updated: ${stats.totalUpdated}`);
    console.log(`⚠️  Clusters skipped: ${stats.totalSkipped}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
main().catch(console.error);