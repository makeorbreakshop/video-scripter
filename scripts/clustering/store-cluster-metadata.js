import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

/**
 * Create or update the cluster metadata tables
 */
async function ensureClusterTables() {
  console.log('Ensuring cluster metadata tables exist...');
  
  // First, let's check if the tables already exist
  const { data: existingTables, error: checkError } = await supabase
    .rpc('get_table_list');
  
  if (checkError) {
    console.log('Could not check existing tables, proceeding with creation...');
  }
  
  // Create cluster metadata table
  const { error: clusterError } = await supabase.rpc('exec_sql', {
    query: `
      CREATE TABLE IF NOT EXISTS cluster_metadata (
        id SERIAL PRIMARY KEY,
        cluster_id INTEGER NOT NULL,
        level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        primary_format VARCHAR(50),
        content_focus VARCHAR(50),
        audience_level VARCHAR(50),
        keywords TEXT[],
        search_terms TEXT[],
        subtopics TEXT[],
        video_count INTEGER DEFAULT 0,
        total_views BIGINT DEFAULT 0,
        avg_views INTEGER DEFAULT 0,
        parent_category_id VARCHAR(100),
        confidence FLOAT,
        generated_by VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        UNIQUE(cluster_id, level)
      );
      
      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_cluster_metadata_level_cluster 
        ON cluster_metadata(level, cluster_id);
      CREATE INDEX IF NOT EXISTS idx_cluster_metadata_name 
        ON cluster_metadata(name);
      CREATE INDEX IF NOT EXISTS idx_cluster_metadata_parent 
        ON cluster_metadata(parent_category_id);
      CREATE INDEX IF NOT EXISTS idx_cluster_metadata_format 
        ON cluster_metadata(primary_format);
      CREATE INDEX IF NOT EXISTS idx_cluster_metadata_focus 
        ON cluster_metadata(content_focus);
    `
  });
  
  if (clusterError) {
    console.error('Error creating cluster_metadata table:', clusterError);
    throw clusterError;
  }
  
  // Create parent categories table
  const { error: parentError } = await supabase.rpc('exec_sql', {
    query: `
      CREATE TABLE IF NOT EXISTS cluster_parent_categories (
        id VARCHAR(100) PRIMARY KEY,
        level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
        name VARCHAR(255) NOT NULL,
        description TEXT,
        content_types TEXT[],
        cluster_count INTEGER DEFAULT 0,
        total_videos INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_parent_categories_level 
        ON cluster_parent_categories(level);
      CREATE INDEX IF NOT EXISTS idx_parent_categories_name 
        ON cluster_parent_categories(name);
    `
  });
  
  if (parentError) {
    console.error('Error creating cluster_parent_categories table:', parentError);
    throw parentError;
  }
  
  console.log('Tables created/verified successfully!');
}

/**
 * Store cluster names and metadata
 */
async function storeClusterNames(namesData, level) {
  console.log(`\nStoring ${namesData.clusters.length} cluster names for level ${level}...`);
  
  const batchSize = 50;
  let successCount = 0;
  
  for (let i = 0; i < namesData.clusters.length; i += batchSize) {
    const batch = namesData.clusters.slice(i, i + batchSize);
    
    const records = batch.map(cluster => ({
      cluster_id: parseInt(cluster.cluster_id),
      level: level,
      name: cluster.name,
      description: cluster.description,
      primary_format: cluster.primary_format,
      content_focus: cluster.content_focus,
      audience_level: cluster.audience_level,
      keywords: cluster.keywords,
      search_terms: cluster.search_terms,
      subtopics: cluster.subtopics,
      video_count: cluster.video_count,
      total_views: cluster.total_views,
      avg_views: cluster.avg_views,
      generated_by: cluster.model || 'claude-3-5-sonnet'
    }));
    
    const { error } = await supabase
      .from('cluster_metadata')
      .upsert(records, { 
        onConflict: 'cluster_id,level',
        ignoreDuplicates: false 
      });
    
    if (error) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, error);
    } else {
      successCount += batch.length;
      console.log(`Progress: ${successCount}/${namesData.clusters.length} clusters stored`);
    }
  }
  
  console.log(`Successfully stored ${successCount} cluster names`);
  return successCount;
}

/**
 * Store cluster hierarchy
 */
async function storeClusterHierarchy(hierarchyData, level) {
  console.log(`\nStoring hierarchy with ${hierarchyData.parent_categories.length} parent categories...`);
  
  // Store parent categories
  const parentRecords = hierarchyData.parent_categories.map(parent => ({
    id: parent.id,
    level: level,
    name: parent.name,
    description: parent.description,
    content_types: parent.content_types || [],
    cluster_count: parent.cluster_count,
    total_videos: parent.total_videos
  }));
  
  const { error: parentError } = await supabase
    .from('cluster_parent_categories')
    .upsert(parentRecords, { 
      onConflict: 'id',
      ignoreDuplicates: false 
    });
  
  if (parentError) {
    console.error('Error storing parent categories:', parentError);
    throw parentError;
  }
  
  console.log(`Stored ${parentRecords.length} parent categories`);
  
  // Update cluster metadata with parent assignments
  let assignmentCount = 0;
  for (const parent of hierarchyData.parent_categories) {
    for (const cluster of parent.clusters) {
      const { error } = await supabase
        .from('cluster_metadata')
        .update({
          parent_category_id: parent.id,
          confidence: cluster.confidence
        })
        .eq('cluster_id', parseInt(cluster.id))
        .eq('level', level);
      
      if (!error) {
        assignmentCount++;
      }
    }
  }
  
  console.log(`Updated ${assignmentCount} cluster parent assignments`);
  return assignmentCount;
}

/**
 * Generate database statistics
 */
async function generateStats(level) {
  console.log('\nGenerating statistics...');
  
  // Get overall stats
  const { data: stats, error: statsError } = await supabase
    .from('cluster_metadata')
    .select('level, primary_format, content_focus, parent_category_id')
    .eq('level', level);
  
  if (statsError) {
    console.error('Error fetching stats:', statsError);
    return;
  }
  
  // Calculate distributions
  const formatDist = {};
  const focusDist = {};
  const parentDist = {};
  
  stats.forEach(row => {
    formatDist[row.primary_format] = (formatDist[row.primary_format] || 0) + 1;
    focusDist[row.content_focus] = (focusDist[row.content_focus] || 0) + 1;
    if (row.parent_category_id) {
      parentDist[row.parent_category_id] = (parentDist[row.parent_category_id] || 0) + 1;
    }
  });
  
  console.log('\nContent Format Distribution:');
  Object.entries(formatDist)
    .sort((a, b) => b[1] - a[1])
    .forEach(([format, count]) => {
      console.log(`  ${format}: ${count} clusters`);
    });
  
  console.log('\nContent Focus Distribution:');
  Object.entries(focusDist)
    .sort((a, b) => b[1] - a[1])
    .forEach(([focus, count]) => {
      console.log(`  ${focus}: ${count} clusters`);
    });
  
  console.log(`\nParent Category Coverage: ${Object.keys(parentDist).length} categories used`);
}

/**
 * Main function
 */
async function main() {
  const level = process.argv[2] ? parseInt(process.argv[2]) : 3;
  const operation = process.argv[3] || 'all'; // 'names', 'hierarchy', or 'all'
  
  if (![1, 2, 3].includes(level)) {
    console.error('Please specify a valid level (1, 2, or 3)');
    console.log('Usage: node store-cluster-metadata.js [level] [operation]');
    console.log('Operations: names, hierarchy, all (default)');
    process.exit(1);
  }
  
  try {
    // Ensure tables exist
    await ensureClusterTables();
    
    if (operation === 'names' || operation === 'all') {
      // Find and load cluster names
      const fs = await import('fs');
      const files = fs.readdirSync('exports');
      const nameFiles = files
        .filter(f => f.startsWith(`cluster-names-level${level}-`) && f.endsWith('.json'))
        .sort();
      
      if (nameFiles.length > 0) {
        const namesFile = path.join('exports', nameFiles.pop());
        console.log(`Loading cluster names from: ${namesFile}`);
        
        const namesData = JSON.parse(readFileSync(namesFile, 'utf-8'));
        await storeClusterNames(namesData, level);
      } else {
        console.log('No cluster names file found. Skipping names storage.');
      }
    }
    
    if (operation === 'hierarchy' || operation === 'all') {
      // Find and load hierarchy
      const fs = await import('fs');
      const files = fs.readdirSync('exports');
      const hierarchyFiles = files
        .filter(f => f.startsWith(`cluster-hierarchy-level${level}-`) && f.endsWith('.json'))
        .sort();
      
      if (hierarchyFiles.length > 0) {
        const hierarchyFile = path.join('exports', hierarchyFiles.pop());
        console.log(`Loading hierarchy from: ${hierarchyFile}`);
        
        const hierarchyData = JSON.parse(readFileSync(hierarchyFile, 'utf-8'));
        await storeClusterHierarchy(hierarchyData, level);
      } else {
        console.log('No hierarchy file found. Skipping hierarchy storage.');
      }
    }
    
    // Generate statistics
    await generateStats(level);
    
    console.log('\nDatabase update complete!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { ensureClusterTables, storeClusterNames, storeClusterHierarchy };