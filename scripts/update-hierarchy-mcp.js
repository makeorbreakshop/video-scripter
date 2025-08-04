#!/usr/bin/env node

/**
 * MCP-based hierarchy update using Supabase tools
 * This approach uses the MCP Supabase tools to execute updates
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load hierarchy mapping
async function loadHierarchyMapping() {
  const mappingPath = path.join(__dirname, '../data/bertopic/better_topic_names_v3_proper_hierarchy.json');
  const content = await fs.readFile(mappingPath, 'utf-8');
  const data = JSON.parse(content);
  return data.topics;
}

// Generate update statements
async function generateUpdateStatements() {
  const mapping = await loadHierarchyMapping();
  const statements = [];

  // Group by domain/niche for efficiency
  const groups = {};
  
  Object.entries(mapping).forEach(([clusterId, info]) => {
    const key = `${info.category}|${info.subcategory}`;
    if (!groups[key]) {
      groups[key] = {
        category: info.category,
        subcategory: info.subcategory,
        clusters: []
      };
    }
    groups[key].clusters.push({
      id: parseInt(clusterId),
      name: info.name
    });
  });

  // Generate efficient update statements
  Object.values(groups).forEach(group => {
    // Group by micro topic name
    const microGroups = {};
    group.clusters.forEach(cluster => {
      if (!microGroups[cluster.name]) {
        microGroups[cluster.name] = [];
      }
      microGroups[cluster.name].push(cluster.id);
    });

    Object.entries(microGroups).forEach(([microName, clusterIds]) => {
      statements.push({
        sql: `UPDATE videos SET topic_domain = $1, topic_niche = $2, topic_micro = $3, updated_at = NOW() WHERE topic_cluster_id = ANY($4::int[])`,
        params: [
          group.category,
          group.subcategory,
          microName,
          clusterIds
        ],
        description: `${group.category} > ${group.subcategory} > ${microName} (${clusterIds.length} clusters)`
      });
    });
  });

  return statements;
}

// Save statements for manual execution
async function saveStatements() {
  const statements = await generateUpdateStatements();
  
  // Create a script that can be run with MCP
  const mcpScript = `// MCP Supabase Update Script
// Run each of these statements using the MCP Supabase execute_sql tool

const updates = ${JSON.stringify(statements, null, 2)};

// Execute each update
for (const update of updates) {
  console.log(\`Executing: \${update.description}\`);
  // Use mcp__supabase__execute_sql with update.sql and update.params
}
`;

  await fs.writeFile(
    path.join(__dirname, '../data/hierarchy-mcp-updates.js'),
    mcpScript
  );

  // Also create individual SQL statements
  let sqlContent = '-- Individual UPDATE statements for manual execution\n\n';
  
  statements.forEach((stmt, idx) => {
    const clusterList = stmt.params[3].join(', ');
    sqlContent += `-- Statement ${idx + 1}: ${stmt.description}\n`;
    sqlContent += `UPDATE videos 
SET 
  topic_domain = '${stmt.params[0].replace(/'/g, "''")}',
  topic_niche = '${stmt.params[1].replace(/'/g, "''")}',
  topic_micro = '${stmt.params[2].replace(/'/g, "''")}',
  updated_at = NOW()
WHERE topic_cluster_id IN (${clusterList});\n\n`;
  });

  await fs.writeFile(
    path.join(__dirname, '../sql/hierarchy-individual-updates.sql'),
    sqlContent
  );

  console.log('✅ Generated update files:');
  console.log('   - data/hierarchy-mcp-updates.js (for MCP execution)');
  console.log('   - sql/hierarchy-individual-updates.sql (for manual SQL)');
  console.log(`\n📊 Total update statements: ${statements.length}`);
  
  return statements;
}

// Main execution
async function main() {
  console.log('🔄 Generating BERTopic hierarchy update statements...\n');
  
  const statements = await saveStatements();
  
  console.log('\n📝 Next steps:');
  console.log('1. Use MCP Supabase tools to execute the updates');
  console.log('2. Or run the SQL statements manually in Supabase SQL editor');
  console.log('3. Each statement updates multiple clusters at once for efficiency');
}

main().catch(console.error);