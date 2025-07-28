#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { spawn } from 'child_process';

// Load environment variables
dotenv.config();

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkClusterData() {
  console.log('Checking cluster data in database...\n');
  
  // Check videos with cluster assignments
  const { data: clusterCounts, error } = await supabase
    .rpc('get_cluster_counts');
  
  if (error) {
    // Fallback query if function doesn't exist
    const { data: level3Count } = await supabase
      .from('videos')
      .select('topic_level_3', { count: 'exact', head: true })
      .not('topic_level_3', 'is', null);
    
    const { data: level2Count } = await supabase
      .from('videos')
      .select('topic_level_2', { count: 'exact', head: true })
      .not('topic_level_2', 'is', null);
    
    const { data: level1Count } = await supabase
      .from('videos')
      .select('topic_level_1', { count: 'exact', head: true })
      .not('topic_level_1', 'is', null);
    
    console.log('Videos with cluster assignments:');
    console.log(`  Level 1: ${level1Count?.count || 0} videos`);
    console.log(`  Level 2: ${level2Count?.count || 0} videos`);
    console.log(`  Level 3: ${level3Count?.count || 0} videos`);
  }
  
  // Get sample clusters
  const { data: sampleClusters } = await supabase
    .from('videos')
    .select('topic_level_3')
    .not('topic_level_3', 'is', null)
    .not('topic_level_3', 'eq', -1)
    .limit(5);
  
  if (sampleClusters && sampleClusters.length > 0) {
    console.log('\nSample cluster IDs (Level 3):');
    sampleClusters.forEach(row => {
      console.log(`  - Cluster ${row.topic_level_3}`);
    });
    
    console.log('\n✅ Cluster data found in database!');
    return true;
  } else {
    console.log('\n❌ No cluster data found in database.');
    console.log('Please ensure BERTopic cluster assignments have been imported.');
    return false;
  }
}

async function testKeywordExtraction() {
  console.log('\n\nTesting keyword extraction (Level 3, first 5 clusters)...');
  
  const child = spawn('node', ['extract-cluster-keywords.js', '3'], {
    cwd: __dirname,
    env: process.env
  });
  
  let output = '';
  child.stdout.on('data', (data) => {
    output += data.toString();
    process.stdout.write(data);
  });
  
  child.stderr.on('data', (data) => {
    process.stderr.write(data);
  });
  
  return new Promise((resolve) => {
    child.on('close', (code) => {
      if (code === 0 && output.includes('Keyword extraction complete!')) {
        console.log('✅ Keyword extraction successful!');
        resolve(true);
      } else {
        console.log('❌ Keyword extraction failed.');
        resolve(false);
      }
    });
  });
}

async function main() {
  console.log('🧪 Testing Cluster Semantic Naming Pipeline\n');
  console.log('This will test the pipeline with a small sample of data.\n');
  
  // Step 1: Check database
  const hasData = await checkClusterData();
  if (!hasData) {
    console.log('\nPlease import BERTopic cluster assignments first.');
    console.log('Look for files like bertopic_results_*.csv');
    process.exit(1);
  }
  
  // Step 2: Test keyword extraction
  const extractionSuccess = await testKeywordExtraction();
  if (!extractionSuccess) {
    console.log('\nKeyword extraction test failed.');
    process.exit(1);
  }
  
  console.log('\n\n🎉 Pipeline test successful!');
  console.log('\nYou can now run the full pipeline with:');
  console.log('  node process-all-clusters.js 3');
  console.log('\nOr process all levels with:');
  console.log('  node process-all-clusters.js all');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}