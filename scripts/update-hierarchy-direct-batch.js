#!/usr/bin/env node

/**
 * Direct batch SQL update for BERTopic hierarchy
 * Uses Supabase SQL editor compatible approach
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

// Generate SQL for manual execution
async function generateBatchSQL() {
  const mappingPath = path.join(__dirname, '../data/bertopic/better_topic_names_v3_proper_hierarchy.json');
  const content = await fs.readFile(mappingPath, 'utf-8');
  const data = JSON.parse(content);
  const mapping = data.topics;

  // Group clusters by niche for more efficient updates
  const nicheGroups = {};
  
  Object.entries(mapping).forEach(([clusterId, info]) => {
    const key = `${info.category}|${info.subcategory}`;
    if (!nicheGroups[key]) {
      nicheGroups[key] = {
        category: info.category,
        subcategory: info.subcategory,
        clusters: []
      };
    }
    nicheGroups[key].clusters.push({
      id: parseInt(clusterId),
      name: info.name
    });
  });

  // Generate SQL statements
  const sqlStatements = [];
  
  Object.values(nicheGroups).forEach(group => {
    // For groups with same micro topic name
    const microGroups = {};
    group.clusters.forEach(cluster => {
      if (!microGroups[cluster.name]) {
        microGroups[cluster.name] = [];
      }
      microGroups[cluster.name].push(cluster.id);
    });

    Object.entries(microGroups).forEach(([microName, clusterIds]) => {
      const sql = `
-- Update ${group.category} > ${group.subcategory} > ${microName}
UPDATE videos 
SET 
  topic_domain = '${group.category.replace(/'/g, "''")}',
  topic_niche = '${group.subcategory.replace(/'/g, "''")}',
  topic_micro = '${microName.replace(/'/g, "''")}',
  updated_at = NOW()
WHERE topic_cluster_id IN (${clusterIds.join(', ')});
`;
      sqlStatements.push(sql);
    });
  });

  // Save SQL file
  const sqlContent = `-- BERTopic Hierarchy Update
-- Generated: ${new Date().toISOString()}
-- Total update statements: ${sqlStatements.length}

BEGIN;

${sqlStatements.join('\n')}

-- Verify the update
SELECT 
  COUNT(*) as updated_videos,
  COUNT(DISTINCT topic_cluster_id) as unique_clusters,
  COUNT(DISTINCT topic_domain) as unique_domains,
  COUNT(DISTINCT topic_niche) as unique_niches,
  COUNT(DISTINCT topic_micro) as unique_micros
FROM videos
WHERE topic_cluster_id IS NOT NULL
  AND topic_domain IS NOT NULL
  AND topic_niche IS NOT NULL
  AND topic_micro IS NOT NULL;

COMMIT;
`;

  await fs.writeFile(
    path.join(__dirname, '../sql/update-hierarchy-batch-final.sql'),
    sqlContent
  );

  console.log('✅ SQL file generated: sql/update-hierarchy-batch-final.sql');
  console.log(`📊 Total update statements: ${sqlStatements.length}`);

  return { sqlStatements, nicheGroups };
}

// Execute updates in small batches via API
async function executeBatchUpdates() {
  const mappingPath = path.join(__dirname, '../data/bertopic/better_topic_names_v3_proper_hierarchy.json');
  const content = await fs.readFile(mappingPath, 'utf-8');
  const data = JSON.parse(content);
  const mapping = data.topics;

  console.log('🚀 Starting batch updates...\n');

  let totalUpdated = 0;
  let totalErrors = 0;
  const batchSize = 10; // Process 10 clusters at a time
  const clusterIds = Object.keys(mapping).map(id => parseInt(id)).sort((a, b) => a - b);

  for (let i = 0; i < clusterIds.length; i += batchSize) {
    const batch = clusterIds.slice(i, i + batchSize);
    console.log(`\nProcessing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(clusterIds.length/batchSize)}: clusters ${batch[0]}-${batch[batch.length-1]}`);

    for (const clusterId of batch) {
      const clusterMapping = mapping[clusterId.toString()];
      if (!clusterMapping) continue;

      try {
        const { data, error } = await supabase
          .from('videos')
          .update({
            topic_domain: clusterMapping.category,
            topic_niche: clusterMapping.subcategory,
            topic_micro: clusterMapping.name,
            updated_at: new Date().toISOString()
          })
          .eq('topic_cluster_id', clusterId)
          .select('id', { count: 'exact' });

        if (error) throw error;

        const count = data?.length || 0;
        totalUpdated += count;
        console.log(`  ✅ Cluster ${clusterId}: ${count} videos updated`);

      } catch (error) {
        totalErrors++;
        console.error(`  ❌ Cluster ${clusterId}: ${error.message}`);
      }
    }

    // Pause between batches
    if (i + batchSize < clusterIds.length) {
      console.log('  ⏳ Pausing for 2 seconds...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('✅ Batch update completed!');
  console.log(`📊 Total videos updated: ${totalUpdated}`);
  console.log(`❌ Total errors: ${totalErrors}`);
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--generate-sql')) {
    await generateBatchSQL();
  } else if (args.includes('--execute')) {
    await executeBatchUpdates();
  } else {
    console.log('Usage:');
    console.log('  node update-hierarchy-direct-batch.js --generate-sql  # Generate SQL file');
    console.log('  node update-hierarchy-direct-batch.js --execute       # Execute via API');
  }
}

main().catch(console.error);