const fs = require('fs').promises;
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createClusterTables() {
  console.log('Creating cluster tables if they don\'t exist...');
  
  const createTableSQL = `
    -- Create content_clusters table
    CREATE TABLE IF NOT EXISTS content_clusters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      keywords TEXT[],
      content_type TEXT,
      size INTEGER,
      total_views BIGINT,
      avg_performance FLOAT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
    );

    -- Create video_cluster_assignments table
    CREATE TABLE IF NOT EXISTS video_cluster_assignments (
      video_id TEXT PRIMARY KEY,
      cluster_id TEXT REFERENCES content_clusters(id),
      confidence FLOAT DEFAULT 1.0,
      assigned_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
      FOREIGN KEY (video_id) REFERENCES videos(video_id) ON DELETE CASCADE
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_cluster_assignments_cluster ON video_cluster_assignments(cluster_id);
    CREATE INDEX IF NOT EXISTS idx_clusters_content_type ON content_clusters(content_type);
    CREATE INDEX IF NOT EXISTS idx_clusters_size ON content_clusters(size DESC);
  `;

  const { error } = await supabase.rpc('exec_sql', { query: createTableSQL });
  
  if (error) {
    console.error('Error creating tables:', error);
    throw error;
  }
  
  console.log('Tables created successfully');
}

async function loadClusterNames(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function loadBertopicResults() {
  const csvContent = await fs.readFile('bertopic_results_20250708_212427.csv', 'utf-8');
  const lines = csvContent.trim().split('\n');
  const headers = lines[0].split(',');
  
  const videoAssignments = new Map();
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index];
    });
    
    if (row.cluster !== '-1') {
      videoAssignments.set(row.video_id, row.cluster);
    }
  }
  
  return videoAssignments;
}

async function saveToDatabase(clusterData, videoAssignments) {
  console.log('\nSaving cluster data to database...');
  
  // First, save cluster metadata
  const clusterRows = clusterData.clusters.map(cluster => ({
    id: cluster.cluster_id,
    name: cluster.name,
    description: cluster.description,
    keywords: cluster.keywords,
    content_type: cluster.content_type,
    size: cluster.size,
    total_views: cluster.total_views,
    avg_performance: cluster.avg_performance
  }));
  
  // Insert clusters in batches
  const batchSize = 50;
  for (let i = 0; i < clusterRows.length; i += batchSize) {
    const batch = clusterRows.slice(i, i + batchSize);
    
    const { error } = await supabase
      .from('content_clusters')
      .upsert(batch, { onConflict: 'id' });
    
    if (error) {
      console.error('Error inserting clusters:', error);
      throw error;
    }
    
    console.log(`Saved ${Math.min(i + batchSize, clusterRows.length)}/${clusterRows.length} clusters`);
  }
  
  // Then save video assignments
  console.log('\nSaving video cluster assignments...');
  
  const assignmentRows = [];
  for (const [videoId, clusterId] of videoAssignments) {
    // Only save assignments for clusters we have names for
    if (clusterData.clusters.some(c => c.cluster_id === clusterId)) {
      assignmentRows.push({
        video_id: videoId,
        cluster_id: clusterId,
        confidence: 1.0
      });
    }
  }
  
  // Insert assignments in batches
  for (let i = 0; i < assignmentRows.length; i += batchSize) {
    const batch = assignmentRows.slice(i, i + batchSize);
    
    const { error } = await supabase
      .from('video_cluster_assignments')
      .upsert(batch, { onConflict: 'video_id' });
    
    if (error) {
      console.error('Error inserting assignments:', error);
      throw error;
    }
    
    console.log(`Saved ${Math.min(i + batchSize, assignmentRows.length)}/${assignmentRows.length} assignments`);
  }
  
  console.log('\nDatabase update complete!');
}

async function generateDatabaseSummary() {
  // Get cluster statistics
  const { data: stats, error } = await supabase
    .from('content_clusters')
    .select('content_type, count')
    .order('size', { ascending: false })
    .limit(20);
  
  if (error) {
    console.error('Error fetching stats:', error);
    return;
  }
  
  console.log('\nTop 20 Clusters by Size:');
  stats.forEach((cluster, i) => {
    console.log(`${i + 1}. ${cluster.name} (${cluster.size} videos)`);
  });
}

async function main() {
  try {
    // Create tables if needed
    await createClusterTables();
    
    // Find the most recent cluster names file
    const files = await fs.readdir('exports');
    const clusterFiles = files.filter(f => f.startsWith('cluster-names-') && f.endsWith('.json'));
    
    if (clusterFiles.length === 0) {
      console.error('No cluster names file found. Please run name-clusters-with-claude.js first.');
      process.exit(1);
    }
    
    const latestFile = clusterFiles.sort().pop();
    const filePath = path.join('exports', latestFile);
    
    console.log(`Loading cluster names from: ${filePath}`);
    const clusterData = await loadClusterNames(filePath);
    
    console.log('Loading video assignments from BERTopic results...');
    const videoAssignments = await loadBertopicResults();
    
    await saveToDatabase(clusterData, videoAssignments);
    await generateDatabaseSummary();
    
    console.log('\nAll done!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { saveToDatabase, createClusterTables };