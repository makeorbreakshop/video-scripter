#!/usr/bin/env node

/**
 * Supabase RPC-based hierarchy update
 * Uses stored procedures to bypass timeout limitations
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

// First, let's create the RPC function in the database
async function createRPCFunction() {
  const createFunctionSQL = `
CREATE OR REPLACE FUNCTION update_topic_hierarchy_batch(
  cluster_ids integer[],
  domains text[],
  niches text[],
  micros text[]
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer := 0;
  i integer;
BEGIN
  -- Validate input arrays have same length
  IF array_length(cluster_ids, 1) != array_length(domains, 1) OR
     array_length(cluster_ids, 1) != array_length(niches, 1) OR
     array_length(cluster_ids, 1) != array_length(micros, 1) THEN
    RAISE EXCEPTION 'All input arrays must have the same length';
  END IF;

  -- Update each cluster
  FOR i IN 1..array_length(cluster_ids, 1) LOOP
    UPDATE videos
    SET 
      topic_domain = domains[i],
      topic_niche = niches[i],
      topic_micro = micros[i],
      updated_at = NOW()
    WHERE topic_cluster_id = cluster_ids[i];
    
    updated_count := updated_count + COALESCE(ROW_COUNT, 0);
  END LOOP;

  RETURN updated_count;
END;
$$;
`;

  console.log('Creating RPC function...');
  const { error } = await supabase.rpc('exec_sql', { sql: createFunctionSQL }).single();
  
  if (error && !error.message.includes('already exists')) {
    console.log('Note: Could not create RPC function via exec_sql, you may need to create it manually in Supabase SQL editor');
    return false;
  }
  
  console.log('✅ RPC function created successfully');
  return true;
}

// Process updates using the RPC function
async function processWithRPC() {
  const mappingPath = path.join(__dirname, '../data/bertopic/better_topic_names_v3_proper_hierarchy.json');
  const content = await fs.readFile(mappingPath, 'utf-8');
  const data = JSON.parse(content);
  const mapping = data.topics;

  const batchSize = 50; // Process 50 clusters at a time via RPC
  const entries = Object.entries(mapping);
  let totalUpdated = 0;

  console.log(`\n🚀 Processing ${entries.length} clusters in batches of ${batchSize}...\n`);

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    
    const clusterIds = batch.map(([id, _]) => parseInt(id));
    const domains = batch.map(([_, info]) => info.category);
    const niches = batch.map(([_, info]) => info.subcategory);
    const micros = batch.map(([_, info]) => info.name);

    console.log(`Batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(entries.length/batchSize)}: Clusters ${clusterIds[0]}-${clusterIds[clusterIds.length-1]}`);

    try {
      const { data, error } = await supabase.rpc('update_topic_hierarchy_batch', {
        cluster_ids: clusterIds,
        domains: domains,
        niches: niches,
        micros: micros
      });

      if (error) throw error;

      const updated = data || 0;
      totalUpdated += updated;
      console.log(`  ✅ Updated ${updated} videos`);

    } catch (error) {
      console.error(`  ❌ Error: ${error.message}`);
      // Continue with next batch
    }

    // Small delay between batches
    if (i + batchSize < entries.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return totalUpdated;
}

// Direct update approach with smaller batches
async function processDirectUpdates() {
  const mappingPath = path.join(__dirname, '../data/bertopic/better_topic_names_v3_proper_hierarchy.json');
  const content = await fs.readFile(mappingPath, 'utf-8');
  const data = JSON.parse(content);
  const mapping = data.topics;

  console.log('🚀 Starting direct updates (this will take a while)...\n');

  let totalUpdated = 0;
  let completedClusters = 0;
  const totalClusters = Object.keys(mapping).length;

  // Process one cluster at a time to avoid timeouts
  for (const [clusterId, info] of Object.entries(mapping)) {
    try {
      const { data: result, error } = await supabase
        .from('videos')
        .update({
          topic_domain: info.category,
          topic_niche: info.subcategory,
          topic_micro: info.name,
          updated_at: new Date().toISOString()
        })
        .eq('topic_cluster_id', parseInt(clusterId))
        .select();

      if (error) throw error;

      const count = result?.length || 0;
      totalUpdated += count;
      completedClusters++;

      if (completedClusters % 10 === 0) {
        console.log(`Progress: ${completedClusters}/${totalClusters} clusters (${Math.round(completedClusters/totalClusters*100)}%) - ${totalUpdated} videos updated`);
      }

    } catch (error) {
      console.error(`❌ Cluster ${clusterId}: ${error.message}`);
    }

    // Minimal delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  return totalUpdated;
}

// Create SQL migration file
async function createMigration() {
  const createFunctionSQL = `
-- Create RPC function for batch updates
CREATE OR REPLACE FUNCTION update_topic_hierarchy_batch(
  cluster_ids integer[],
  domains text[],
  niches text[],
  micros text[]
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer := 0;
  i integer;
BEGIN
  -- Validate input arrays have same length
  IF array_length(cluster_ids, 1) != array_length(domains, 1) OR
     array_length(cluster_ids, 1) != array_length(niches, 1) OR
     array_length(cluster_ids, 1) != array_length(micros, 1) THEN
    RAISE EXCEPTION 'All input arrays must have the same length';
  END IF;

  -- Update each cluster
  FOR i IN 1..array_length(cluster_ids, 1) LOOP
    UPDATE videos
    SET 
      topic_domain = domains[i],
      topic_niche = niches[i],
      topic_micro = micros[i],
      updated_at = NOW()
    WHERE topic_cluster_id = cluster_ids[i];
    
    updated_count := updated_count + ROW_COUNT;
  END LOOP;

  RETURN updated_count;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION update_topic_hierarchy_batch(integer[], text[], text[], text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION update_topic_hierarchy_batch(integer[], text[], text[], text[]) TO service_role;
`;

  await fs.writeFile(
    path.join(__dirname, '../sql/create-hierarchy-update-function.sql'),
    createFunctionSQL
  );

  console.log('✅ Created migration file: sql/create-hierarchy-update-function.sql');
  console.log('   Run this in Supabase SQL editor first!');
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--create-migration')) {
    await createMigration();
    return;
  }

  console.log('🔄 BERTopic Hierarchy Update\n');

  // Check current state
  const { data: stats } = await supabase
    .from('videos')
    .select('topic_cluster_id', { count: 'exact' })
    .not('topic_cluster_id', 'is', null)
    .not('topic_domain', 'is', null)
    .like('topic_domain', '%domain_%');

  const needsUpdate = stats?.length || 0;
  
  if (needsUpdate === 0) {
    // Check if already updated
    const { count } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('topic_cluster_id', 'is', null)
      .not('topic_domain', 'is', null);

    if (count > 0) {
      console.log('✅ Hierarchy already updated!');
      console.log(`📊 ${count} videos have proper hierarchy values`);
      return;
    }
  }

  console.log(`📊 Found ${needsUpdate} videos that need updating\n`);

  let totalUpdated = 0;

  // Try RPC approach first
  if (args.includes('--rpc')) {
    const rpcCreated = await createRPCFunction();
    if (rpcCreated) {
      totalUpdated = await processWithRPC();
    } else {
      console.log('⚠️  RPC function not available, falling back to direct updates');
      totalUpdated = await processDirectUpdates();
    }
  } else {
    // Default to direct updates
    totalUpdated = await processDirectUpdates();
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ Update completed!');
  console.log(`📊 Total videos updated: ${totalUpdated}`);
  console.log('='.repeat(50));
}

main().catch(console.error);