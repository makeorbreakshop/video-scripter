#!/usr/bin/env node

/**
 * Test script for incremental clustering system
 * Verifies that all components are working correctly
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

async function testDatabaseConnectivity() {
  console.log('Testing database connectivity...');
  
  try {
    // Test basic query
    const { count, error } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    
    console.log(`✓ Database connected. Total videos: ${count}`);
    return true;
  } catch (error) {
    console.error('✗ Database connection failed:', error.message);
    return false;
  }
}

async function testClusterData() {
  console.log('\nTesting cluster data...');
  
  try {
    // Check if clusters exist
    const { data: clusters, error: clusterError } = await supabase
      .from('bertopic_clusters')
      .select('cluster_id')
      .limit(5);
    
    if (clusterError) throw clusterError;
    
    if (!clusters || clusters.length === 0) {
      console.log('✗ No clusters found. Run initial clustering first.');
      return false;
    }
    
    console.log(`✓ Found ${clusters.length} clusters`);
    
    // Check for centroid embeddings
    const { data: centroids, error: centroidError } = await supabase
      .from('bertopic_clusters')
      .select('cluster_id, centroid_embedding')
      .not('centroid_embedding', 'is', null)
      .limit(1);
    
    if (centroidError) throw centroidError;
    
    if (!centroids || centroids.length === 0) {
      console.log('✗ No cluster centroids found. Centroids are required for assignment.');
      return false;
    }
    
    console.log('✓ Cluster centroids available');
    return true;
    
  } catch (error) {
    console.error('✗ Cluster data test failed:', error.message);
    return false;
  }
}

async function testUnassignedVideos() {
  console.log('\nTesting for unassigned videos...');
  
  try {
    const { count: totalUnassigned, error: totalError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('topic_cluster_id', null)
      .not('title_embedding', 'is', null);
    
    if (totalError) throw totalError;
    
    console.log(`✓ Found ${totalUnassigned} unassigned videos with embeddings`);
    
    if (totalUnassigned > 0) {
      // Get a sample
      const { data: sample, error: sampleError } = await supabase
        .from('videos')
        .select('id, title, channel_name')
        .is('topic_cluster_id', null)
        .not('title_embedding', 'is', null)
        .limit(3);
      
      if (!sampleError && sample) {
        console.log('\nSample unassigned videos:');
        sample.forEach(v => console.log(`  - ${v.title} (${v.channel_name})`));
      }
    }
    
    return true;
    
  } catch (error) {
    console.error('✗ Unassigned videos test failed:', error.message);
    return false;
  }
}

async function testRequiredTables() {
  console.log('\nTesting required tables...');
  
  const requiredTables = [
    'cluster_assignment_logs',
    'cluster_snapshots',
    'cluster_transitions',
    'cluster_evolution_metrics'
  ];
  
  let allTablesExist = true;
  
  for (const table of requiredTables) {
    try {
      const { error } = await supabase
        .from(table)
        .select('*')
        .limit(1);
      
      if (error && error.code === '42P01') {
        console.log(`✗ Table '${table}' does not exist`);
        allTablesExist = false;
      } else {
        console.log(`✓ Table '${table}' exists`);
      }
    } catch (error) {
      console.log(`✗ Error checking table '${table}':`, error.message);
      allTablesExist = false;
    }
  }
  
  if (!allTablesExist) {
    console.log('\nRun the SQL setup scripts to create missing tables:');
    console.log('  psql $DATABASE_URL < sql/create-cluster-assignment-logs.sql');
    console.log('  psql $DATABASE_URL < sql/create-similarity-search-function.sql');
  }
  
  return allTablesExist;
}

async function testSimilarityFunction() {
  console.log('\nTesting similarity search function...');
  
  try {
    // Get a sample embedding
    const { data: sample, error: sampleError } = await supabase
      .from('videos')
      .select('title_embedding')
      .not('title_embedding', 'is', null)
      .limit(1)
      .single();
    
    if (sampleError || !sample) {
      console.log('✗ Could not get sample embedding');
      return false;
    }
    
    // Test the function
    const { data, error } = await supabase.rpc('find_similar_videos_by_embedding', {
      query_embedding: sample.title_embedding,
      similarity_threshold: 0.8,
      max_results: 5
    });
    
    if (error) {
      if (error.code === '42883') {
        console.log('✗ Similarity function does not exist');
        console.log('  Run: psql $DATABASE_URL < sql/create-similarity-search-function.sql');
      } else {
        console.log('✗ Similarity function error:', error.message);
      }
      return false;
    }
    
    console.log(`✓ Similarity function works (found ${data?.length || 0} similar videos)`);
    return true;
    
  } catch (error) {
    console.error('✗ Similarity function test failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('=== Incremental Clustering System Test ===\n');
  
  const tests = [
    { name: 'Database Connectivity', fn: testDatabaseConnectivity },
    { name: 'Cluster Data', fn: testClusterData },
    { name: 'Unassigned Videos', fn: testUnassignedVideos },
    { name: 'Required Tables', fn: testRequiredTables },
    { name: 'Similarity Function', fn: testSimilarityFunction }
  ];
  
  let passedTests = 0;
  
  for (const test of tests) {
    const passed = await test.fn();
    if (passed) passedTests++;
    console.log('');
  }
  
  console.log('=== Test Summary ===');
  console.log(`Passed: ${passedTests}/${tests.length} tests`);
  
  if (passedTests === tests.length) {
    console.log('\n✓ All tests passed! The incremental clustering system is ready to use.');
    console.log('\nRun the daily worker with: npm run worker:clustering');
  } else {
    console.log('\n✗ Some tests failed. Please fix the issues above before running the system.');
    process.exit(1);
  }
}

// Run tests
main();