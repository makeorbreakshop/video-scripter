#!/usr/bin/env node

/**
 * Creates a Supabase migration for the hierarchy update
 * This approach uses the migration system which may have different timeout rules
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createMigration() {
  const mappingPath = path.join(__dirname, '../data/bertopic/better_topic_names_v3_proper_hierarchy.json');
  const content = await fs.readFile(mappingPath, 'utf-8');
  const data = JSON.parse(content);
  const mapping = data.topics;

  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const migrationName = `${timestamp}_update_bertopic_hierarchy.sql`;

  let migration = `-- Update BERTopic hierarchy
-- This migration updates the topic hierarchy for all videos

-- First, create a function to handle the updates in batches
CREATE OR REPLACE FUNCTION update_topic_hierarchy_batch()
RETURNS void AS $$
DECLARE
  batch_size INTEGER := 1000;
  offset_val INTEGER := 0;
  total_updated INTEGER := 0;
  batch_count INTEGER;
BEGIN
  -- Disable triggers temporarily for performance
  SET session_replication_role = replica;
  
  -- Set a long timeout for this operation
  SET LOCAL statement_timeout = '4h';
  
  RAISE NOTICE 'Starting BERTopic hierarchy update...';

`;

  // Generate CASE statements for each field
  const domainCases = [];
  const nicheCases = [];
  const microCases = [];

  Object.entries(mapping).forEach(([clusterId, info]) => {
    domainCases.push(`    WHEN ${clusterId} THEN '${info.category.replace(/'/g, "''")}'`);
    nicheCases.push(`    WHEN ${clusterId} THEN '${info.subcategory.replace(/'/g, "''")}'`);
    microCases.push(`    WHEN ${clusterId} THEN '${info.name.replace(/'/g, "''")}'`);
  });

  migration += `  -- Update in batches to avoid memory issues
  LOOP
    WITH batch AS (
      SELECT id, topic_cluster_id
      FROM videos
      WHERE topic_cluster_id IS NOT NULL
      ORDER BY id
      LIMIT batch_size
      OFFSET offset_val
    )
    UPDATE videos v
    SET 
      topic_domain = CASE topic_cluster_id
${domainCases.join('\n')}
        ELSE topic_domain
      END,
      topic_niche = CASE topic_cluster_id
${nicheCases.join('\n')}
        ELSE topic_niche
      END,
      topic_micro = CASE topic_cluster_id
${microCases.join('\n')}
        ELSE topic_micro
      END,
      updated_at = NOW()
    FROM batch b
    WHERE v.id = b.id
      AND v.topic_cluster_id IN (${Object.keys(mapping).join(', ')});
    
    GET DIAGNOSTICS batch_count = ROW_COUNT;
    total_updated := total_updated + batch_count;
    
    EXIT WHEN batch_count = 0;
    
    offset_val := offset_val + batch_size;
    
    -- Log progress every 10,000 records
    IF total_updated % 10000 = 0 THEN
      RAISE NOTICE 'Updated % records...', total_updated;
    END IF;
  END LOOP;
  
  -- Re-enable triggers
  SET session_replication_role = DEFAULT;
  
  RAISE NOTICE 'Update completed. Total records updated: %', total_updated;
END;
$$ LANGUAGE plpgsql;

-- Execute the function
SELECT update_topic_hierarchy_batch();

-- Drop the function after use
DROP FUNCTION update_topic_hierarchy_batch();

-- Verify the update
DO $$
DECLARE
  updated_count INTEGER;
  cluster_count INTEGER;
BEGIN
  SELECT 
    COUNT(*),
    COUNT(DISTINCT topic_cluster_id)
  INTO updated_count, cluster_count
  FROM videos
  WHERE topic_cluster_id IS NOT NULL
    AND topic_domain IS NOT NULL
    AND topic_niche IS NOT NULL
    AND topic_micro IS NOT NULL
    AND topic_domain NOT LIKE 'domain_%';
    
  RAISE NOTICE 'Verification: % videos updated across % clusters', updated_count, cluster_count;
END $$;
`;

  // Create migrations directory if it doesn't exist
  const migrationsDir = path.join(__dirname, '../supabase/migrations');
  await fs.mkdir(migrationsDir, { recursive: true });

  // Write migration file
  const migrationPath = path.join(migrationsDir, migrationName);
  await fs.writeFile(migrationPath, migration);

  console.log('✅ Migration created successfully!');
  console.log(`📄 File: supabase/migrations/${migrationName}`);
  console.log('\n📝 Next steps:');
  console.log('1. Review the migration file');
  console.log('2. Run locally: supabase migration up');
  console.log('3. Deploy to production: supabase db push');
  console.log('\n💡 This migration:');
  console.log('   - Sets a 4-hour timeout for the operation');
  console.log('   - Processes updates in batches of 1,000 records');
  console.log('   - Temporarily disables triggers for performance');
  console.log('   - Provides progress updates every 10,000 records');

  return migrationPath;
}

// Alternative: Create simple migration without batching
async function createSimpleMigration() {
  const mappingPath = path.join(__dirname, '../data/bertopic/better_topic_names_v3_proper_hierarchy.json');
  const content = await fs.readFile(mappingPath, 'utf-8');
  const data = JSON.parse(content);
  const mapping = data.topics;

  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const migrationName = `${timestamp}_update_bertopic_hierarchy_simple.sql`;

  let migration = `-- Simple BERTopic hierarchy update
-- Warning: This may timeout on large datasets

-- Set timeout for this migration
SET LOCAL statement_timeout = '4h';

-- Perform updates grouped by domain/niche for efficiency
`;

  // Group by domain/niche/micro
  const groups = {};
  Object.entries(mapping).forEach(([clusterId, info]) => {
    const key = `${info.category}|${info.subcategory}|${info.name}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(parseInt(clusterId));
  });

  Object.entries(groups).forEach(([key, clusterIds]) => {
    const [domain, niche, micro] = key.split('|');
    migration += `
-- Update: ${domain} > ${niche} > ${micro}
UPDATE videos 
SET 
  topic_domain = '${domain.replace(/'/g, "''")}',
  topic_niche = '${niche.replace(/'/g, "''")}',
  topic_micro = '${micro.replace(/'/g, "''")}',
  updated_at = NOW()
WHERE topic_cluster_id IN (${clusterIds.join(', ')});
`;
  });

  // Create migrations directory if it doesn't exist
  const migrationsDir = path.join(__dirname, '../supabase/migrations');
  await fs.mkdir(migrationsDir, { recursive: true });

  // Write migration file
  const migrationPath = path.join(migrationsDir, migrationName);
  await fs.writeFile(migrationPath, migration);

  console.log('✅ Simple migration created!');
  console.log(`📄 File: supabase/migrations/${migrationName}`);

  return migrationPath;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--simple')) {
    await createSimpleMigration();
  } else {
    await createMigration();
  }
}

main().catch(console.error);