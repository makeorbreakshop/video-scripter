#!/usr/bin/env node

/**
 * Fix baseline multiplication error using MCP tools
 * Since direct database connection isn't working
 */

import { execSync } from 'child_process';

const P50_VALUE = 29742;

async function executeSql(query) {
  const escaped = query.replace(/'/g, "'\\''").replace(/"/g, '\\"');
  const cmd = `mcp query supabase execute_sql '{"query": "${escaped}"}'`;
  
  try {
    const result = execSync(cmd, { encoding: 'utf8' });
    const match = result.match(/<untrusted-data-[^>]+>(.*?)<\/untrusted-data/s);
    if (match) {
      return JSON.parse(match[1]);
    }
    return [];
  } catch (error) {
    console.error('SQL Error:', error.message);
    throw error;
  }
}

async function main() {
  console.log('🔧 FIXING BASELINE MULTIPLICATION ERROR VIA MCP');
  console.log('===============================================\n');
  
  // Count affected videos
  console.log('Counting affected videos...');
  const countResult = await executeSql(`
    SELECT COUNT(*) as count
    FROM videos
    WHERE channel_baseline_at_publish < 100 
      AND channel_baseline_at_publish > 0
  `);
  
  const totalCount = parseInt(countResult[0].count);
  console.log(`Found ${totalCount.toLocaleString()} videos with broken baselines\n`);
  
  if (totalCount === 0) {
    console.log('✅ No broken baselines found!');
    return;
  }
  
  // Fix in batches
  const BATCH_SIZE = 1000;
  let offset = 0;
  let fixed = 0;
  
  while (fixed < totalCount) {
    console.log(`Processing batch ${Math.floor(fixed/BATCH_SIZE) + 1}...`);
    
    // Update batch
    const updateQuery = `
      UPDATE videos
      SET 
        channel_baseline_at_publish = channel_baseline_at_publish * ${P50_VALUE},
        temporal_performance_score = LEAST(
          view_count / (channel_baseline_at_publish * ${P50_VALUE}),
          99999.999
        )
      WHERE channel_baseline_at_publish < 100 
        AND channel_baseline_at_publish > 0
      LIMIT ${BATCH_SIZE}
    `;
    
    try {
      await executeSql(updateQuery);
      fixed += BATCH_SIZE;
      console.log(`  ✅ Fixed up to ${Math.min(fixed, totalCount)} videos`);
    } catch (error) {
      console.error('  ❌ Batch failed:', error.message);
      break;
    }
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Verify
  console.log('\n🔍 Verifying fix...');
  const verifyResult = await executeSql(`
    SELECT COUNT(*) as remaining
    FROM videos
    WHERE channel_baseline_at_publish < 100 
      AND channel_baseline_at_publish > 0
  `);
  
  const remaining = parseInt(verifyResult[0].remaining);
  if (remaining === 0) {
    console.log('✅ All baselines fixed successfully!');
  } else {
    console.log(`⚠️  ${remaining} videos still have broken baselines`);
  }
}

main().catch(console.error);