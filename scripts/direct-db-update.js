#!/usr/bin/env node

/**
 * Direct database connection for bulk updates
 * Bypasses Supabase API timeouts by connecting directly to PostgreSQL
 */

import { Client } from 'pg';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse connection string from Supabase
function parseConnectionString(url) {
  const dbUrl = new URL(url);
  return {
    user: dbUrl.username,
    password: dbUrl.password,
    host: dbUrl.hostname,
    port: dbUrl.port || 5432,
    database: dbUrl.pathname.slice(1),
    ssl: { rejectUnauthorized: false }
  };
}

async function updateWithDirectConnection() {
  // Get database URL from Supabase dashboard
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL or DIRECT_URL environment variable');
    console.log('\n💡 Get your direct connection string from:');
    console.log('   Supabase Dashboard > Settings > Database > Connection String > URI');
    console.log('   Add it to your .env file as DATABASE_URL=postgres://...');
    return;
  }

  const client = new Client(parseConnectionString(DATABASE_URL));

  try {
    console.log('🔌 Connecting directly to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // First, set a long timeout for this session
    await client.query("SET statement_timeout = '2h'");
    console.log('⏱️  Set statement timeout to 2 hours\n');

    // Load the mapping
    const mappingPath = path.join(__dirname, '../data/bertopic/better_topic_names_v3_proper_hierarchy.json');
    const content = await fs.readFile(mappingPath, 'utf-8');
    const data = JSON.parse(content);
    const mapping = data.topics;

    console.log(`📊 Processing ${Object.keys(mapping).length} clusters...\n`);

    let totalUpdated = 0;
    let completedClusters = 0;

    // Process clusters in batches
    const clusterGroups = {};
    
    // Group by domain/niche/micro for efficiency
    Object.entries(mapping).forEach(([clusterId, info]) => {
      const key = `${info.category}|${info.subcategory}|${info.name}`;
      if (!clusterGroups[key]) {
        clusterGroups[key] = [];
      }
      clusterGroups[key].push(parseInt(clusterId));
    });

    // Update each group
    const totalGroups = Object.keys(clusterGroups).length;
    let currentGroup = 0;

    for (const [key, clusterIds] of Object.entries(clusterGroups)) {
      currentGroup++;
      const [domain, niche, micro] = key.split('|');
      
      console.log(`[${currentGroup}/${totalGroups}] Updating: ${domain} > ${niche} > ${micro}`);
      console.log(`  Clusters: ${clusterIds.join(', ')}`);

      try {
        const result = await client.query(
          `UPDATE videos 
           SET topic_domain = $1,
               topic_niche = $2,
               topic_micro = $3,
               updated_at = NOW()
           WHERE topic_cluster_id = ANY($4::int[])`,
          [domain, niche, micro, clusterIds]
        );

        const rowCount = result.rowCount || 0;
        totalUpdated += rowCount;
        completedClusters += clusterIds.length;
        
        console.log(`  ✅ Updated ${rowCount} videos\n`);

      } catch (error) {
        console.error(`  ❌ Error: ${error.message}\n`);
      }
    }

    // Final verification
    const verifyResult = await client.query(`
      SELECT 
        COUNT(*) as total_updated,
        COUNT(DISTINCT topic_cluster_id) as unique_clusters
      FROM videos
      WHERE topic_cluster_id IS NOT NULL
        AND topic_domain IS NOT NULL
        AND topic_niche IS NOT NULL
        AND topic_micro IS NOT NULL
        AND topic_domain NOT LIKE 'domain_%'
    `);

    console.log('='.repeat(50));
    console.log('✅ Update completed!');
    console.log(`📊 Total videos updated: ${totalUpdated}`);
    console.log(`📊 Verified in database: ${verifyResult.rows[0].total_updated} videos`);
    console.log(`📊 Unique clusters: ${verifyResult.rows[0].unique_clusters}`);
    console.log('='.repeat(50));

  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

// Alternative: Generate SQL script for manual execution
async function generateDirectSQL() {
  const mappingPath = path.join(__dirname, '../data/bertopic/better_topic_names_v3_proper_hierarchy.json');
  const content = await fs.readFile(mappingPath, 'utf-8');
  const data = JSON.parse(content);
  const mapping = data.topics;

  let sql = `-- Direct PostgreSQL update script
-- Run this in pgAdmin, TablePlus, or psql

-- Set timeout for the session
SET statement_timeout = '2h';

-- Begin transaction
BEGIN;

`;

  // Generate efficient updates
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
    sql += `
-- ${domain} > ${niche} > ${micro}
UPDATE videos 
SET topic_domain = '${domain.replace(/'/g, "''")}',
    topic_niche = '${niche.replace(/'/g, "''")}',
    topic_micro = '${micro.replace(/'/g, "''")}',
    updated_at = NOW()
WHERE topic_cluster_id IN (${clusterIds.join(', ')});
`;
  });

  sql += `
-- Verify the update
SELECT 
  COUNT(*) as total_updated,
  COUNT(DISTINCT topic_cluster_id) as unique_clusters
FROM videos
WHERE topic_cluster_id IS NOT NULL
  AND topic_domain IS NOT NULL
  AND topic_niche IS NOT NULL
  AND topic_micro IS NOT NULL;

-- Commit if everything looks good
COMMIT;

-- Or rollback if there are issues
-- ROLLBACK;
`;

  await fs.writeFile(
    path.join(__dirname, '../sql/direct-postgres-update.sql'),
    sql
  );

  console.log('✅ Generated SQL file: sql/direct-postgres-update.sql');
  console.log('\n📝 Next steps:');
  console.log('1. Get your direct connection string from Supabase Dashboard');
  console.log('2. Connect using pgAdmin, TablePlus, or psql');
  console.log('3. Run the generated SQL file');
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--generate-sql')) {
    await generateDirectSQL();
  } else if (args.includes('--help')) {
    console.log('Usage:');
    console.log('  node direct-db-update.js              # Run update via direct connection');
    console.log('  node direct-db-update.js --generate-sql  # Generate SQL for manual execution');
  } else {
    await updateWithDirectConnection();
  }
}

main().catch(console.error);