import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function loadCentroidsToDatabase() {
  console.log('Loading centroids from file...');
  
  // Load the calculated centroids
  const centroidData = JSON.parse(
    await fs.readFile('./bertopic_centroids_complete_20250803.json', 'utf-8')
  );
  
  console.log(`Found ${Object.keys(centroidData.centroids).length} centroids to load`);
  console.log('Metadata:', centroidData.metadata);
  
  // First, clear existing entries to avoid duplicates
  console.log('\nClearing existing bertopic_clusters entries...');
  const { error: deleteError } = await supabase
    .from('bertopic_clusters')
    .delete()
    .gte('cluster_id', 0)
    .lte('cluster_id', 215);
    
  if (deleteError) {
    console.error('Error clearing existing entries:', deleteError);
    return;
  }
  
  // Prepare data for insertion
  const rows = [];
  
  for (const [topicId, centroid] of Object.entries(centroidData.centroids)) {
    // Use blended centroid if available, otherwise fall back to title centroid
    const embeddingToUse = centroid.blended_centroid || centroid.title_centroid;
    
    if (!embeddingToUse) {
      console.warn(`Skipping topic ${topicId} - no centroid available`);
      continue;
    }
    
    rows.push({
      cluster_id: parseInt(topicId),
      topic_name: centroid.topic_name,
      parent_topic: centroid.topic_level_2 !== undefined ? `niche_${centroid.topic_level_2}` : null,
      grandparent_topic: centroid.topic_level_1 !== undefined ? `domain_${centroid.topic_level_1}` : null,
      centroid_embedding: JSON.stringify(embeddingToUse),
      video_count: centroid.video_count,
      updated_at: new Date().toISOString()
    });
  }
  
  console.log(`\nPrepared ${rows.length} rows for insertion`);
  
  // Insert in batches of 50
  const batchSize = 50;
  let inserted = 0;
  
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    
    const { error: insertError } = await supabase
      .from('bertopic_clusters')
      .insert(batch);
      
    if (insertError) {
      console.error(`Error inserting batch starting at ${i}:`, insertError);
      return;
    }
    
    inserted += batch.length;
    console.log(`Inserted ${inserted}/${rows.length} rows...`);
  }
  
  console.log('\nVerifying insertion...');
  const { count } = await supabase
    .from('bertopic_clusters')
    .select('*', { count: 'exact', head: true })
    .gte('cluster_id', 0)
    .lte('cluster_id', 215);
    
  console.log(`Total bertopic_clusters entries for topics 0-215: ${count}`);
  
  // Show summary of what was loaded
  console.log('\nSummary of loaded centroids:');
  console.log(`- Total topics: ${rows.length}`);
  console.log(`- Topics with blended centroids: ${Object.values(centroidData.centroids).filter(c => c.blended_centroid).length}`);
  console.log(`- Total videos represented: ${rows.reduce((sum, r) => sum + r.video_count, 0)}`);
  
  // Show a few examples
  console.log('\nExample entries:');
  const examples = rows.slice(0, 3);
  examples.forEach(row => {
    console.log(`\n- Topic ${row.cluster_id}: ${row.topic_name}`);
    console.log(`  Videos: ${row.video_count}`);
    console.log(`  Hierarchy: ${row.grandparent_topic} > ${row.parent_topic}`);
    console.log(`  Embedding length: ${JSON.parse(row.centroid_embedding).length}`);
  });
  
  console.log('\n✅ Centroids successfully loaded to database!');
}

// Run the script
loadCentroidsToDatabase().catch(console.error);