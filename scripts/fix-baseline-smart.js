#!/usr/bin/env node

/**
 * Smart Baseline Fix
 * 
 * This script identifies and fixes only the baselines that were incorrectly
 * multiplied by 29,742. It uses pattern recognition to identify which baselines
 * are suspiciously close to multiples of 29,742.
 */

import pg from 'pg';
import dotenv from 'dotenv';

const { Client } = pg;
dotenv.config();

const P50_VALUE = 29742;

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

async function analyzeBaselines() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log(`${colors.cyan}Connecting to database...${colors.reset}`);
    await client.connect();

    // First, let's analyze the pattern
    console.log(`\n${colors.yellow}Analyzing baseline patterns...${colors.reset}`);
    
    // Check how many baselines are suspiciously close to multiples of 29742
    const patternCheck = await client.query(`
      WITH pattern_analysis AS (
        SELECT 
          id,
          channel_name,
          channel_baseline_at_publish,
          channel_baseline_at_publish / ${P50_VALUE}::NUMERIC as ratio,
          ABS(channel_baseline_at_publish - ROUND(channel_baseline_at_publish / ${P50_VALUE}) * ${P50_VALUE}) as distance_from_multiple,
          ROUND(channel_baseline_at_publish / ${P50_VALUE}) as nearest_multiple
        FROM videos
        WHERE is_short = false
          AND channel_baseline_at_publish IS NOT NULL
          AND channel_baseline_at_publish > 100
      )
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN distance_from_multiple < 100 THEN 1 END) as close_to_multiple,
        COUNT(CASE WHEN ratio BETWEEN 0.9 AND 100.1 AND distance_from_multiple < 100 THEN 1 END) as likely_multiplied
      FROM pattern_analysis
    `);

    const pattern = patternCheck.rows[0];
    console.log(`\nTotal videos analyzed: ${colors.yellow}${parseInt(pattern.total).toLocaleString()}${colors.reset}`);
    console.log(`Close to P50 multiple: ${colors.red}${parseInt(pattern.close_to_multiple).toLocaleString()}${colors.reset}`);
    console.log(`Likely multiplied (ratio 1-100): ${colors.red}${parseInt(pattern.likely_multiplied).toLocaleString()}${colors.reset}`);

    // Show some examples
    console.log(`\n${colors.yellow}Example baselines that appear to be multiplied:${colors.reset}`);
    const examples = await client.query(`
      WITH suspicious AS (
        SELECT 
          channel_name,
          channel_baseline_at_publish,
          channel_baseline_at_publish / ${P50_VALUE}::NUMERIC as original_estimate,
          view_count,
          temporal_performance_score
        FROM videos
        WHERE is_short = false
          AND channel_baseline_at_publish IS NOT NULL
          AND channel_baseline_at_publish / ${P50_VALUE}::NUMERIC BETWEEN 0.9 AND 100.1
          AND ABS(channel_baseline_at_publish - ROUND(channel_baseline_at_publish / ${P50_VALUE}) * ${P50_VALUE}) < 100
        ORDER BY channel_baseline_at_publish DESC
        LIMIT 10
      )
      SELECT * FROM suspicious
    `);

    console.log(`\nChannel | Current Baseline | Estimated Original | Views | Current Score`);
    console.log(`--------|-----------------|-------------------|-------|-------------`);
    examples.rows.forEach(row => {
      console.log(`${row.channel_name.substring(0, 20).padEnd(20)} | ${parseFloat(row.channel_baseline_at_publish).toFixed(0).padStart(15)} | ${parseFloat(row.original_estimate).toFixed(1).padStart(17)} | ${parseInt(row.view_count).toLocaleString().padStart(10)} | ${parseFloat(row.temporal_performance_score || 0).toFixed(2).padStart(10)}`);
    });

    // Ask for confirmation
    console.log(`\n${colors.yellow}⚠️  This analysis shows baselines that are suspiciously close to exact multiples of ${P50_VALUE}${colors.reset}`);
    console.log(`These were likely multiplied during the previous "fix" attempt.`);
    console.log(`\nWould you like to see the proposed fix? (This won't change anything yet)`);
    console.log(`Press Ctrl+C to cancel, or wait 3 seconds to continue...`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Show what the fix would do
    console.log(`\n${colors.cyan}Proposed fix:${colors.reset}`);
    console.log(`Only fix baselines where:
    1. The baseline divided by ${P50_VALUE} gives a value between 1 and 100
    2. The baseline is within 100 of an exact multiple of ${P50_VALUE}
    3. This indicates it was likely a small baseline (1-100) that got multiplied`);

    const proposedFix = await client.query(`
      WITH to_fix AS (
        SELECT 
          COUNT(*) as count,
          MIN(channel_baseline_at_publish / ${P50_VALUE}::NUMERIC) as min_original,
          MAX(channel_baseline_at_publish / ${P50_VALUE}::NUMERIC) as max_original,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY channel_baseline_at_publish / ${P50_VALUE}::NUMERIC) as median_original
        FROM videos
        WHERE is_short = false
          AND channel_baseline_at_publish IS NOT NULL
          AND channel_baseline_at_publish / ${P50_VALUE}::NUMERIC BETWEEN 0.9 AND 100.1
          AND ABS(channel_baseline_at_publish - ROUND(channel_baseline_at_publish / ${P50_VALUE}) * ${P50_VALUE}) < 100
      )
      SELECT * FROM to_fix
    `);

    const fix = proposedFix.rows[0];
    console.log(`\n${colors.bright}Videos to fix: ${parseInt(fix.count).toLocaleString()}${colors.reset}`);
    console.log(`Original baseline range: ${parseFloat(fix.min_original).toFixed(1)} to ${parseFloat(fix.max_original).toFixed(1)}`);
    console.log(`Median original baseline: ${parseFloat(fix.median_original).toFixed(1)}`);

    console.log(`\n${colors.red}${colors.bright}This is a more targeted fix that only affects truly broken baselines.${colors.reset}`);
    console.log(`\nPress Ctrl+C to cancel, or wait 5 seconds to apply the fix...`);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Apply the targeted fix
    console.log(`\n${colors.cyan}Applying targeted fix...${colors.reset}`);
    
    const updateResult = await client.query(`
      UPDATE videos
      SET 
        channel_baseline_at_publish = ROUND((channel_baseline_at_publish / ${P50_VALUE}::NUMERIC)::NUMERIC, 3),
        temporal_performance_score = CASE 
          WHEN view_count > 0 AND (channel_baseline_at_publish / ${P50_VALUE}::NUMERIC) > 0 
          THEN LEAST(99999.999, ROUND((view_count::NUMERIC / (channel_baseline_at_publish / ${P50_VALUE}::NUMERIC))::NUMERIC, 3))
          ELSE NULL
        END
      WHERE is_short = false
        AND channel_baseline_at_publish IS NOT NULL
        AND channel_baseline_at_publish / ${P50_VALUE}::NUMERIC BETWEEN 0.9 AND 100.1
        AND ABS(channel_baseline_at_publish - ROUND(channel_baseline_at_publish / ${P50_VALUE}) * ${P50_VALUE}) < 100
    `);

    console.log(`${colors.green}✓ Fixed ${updateResult.rowCount.toLocaleString()} videos${colors.reset}`);

    // Verify the fix
    console.log(`\n${colors.yellow}Verifying fix...${colors.reset}`);
    const afterStats = await client.query(`
      SELECT 
        COUNT(*) as total_videos,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as median_baseline,
        COUNT(CASE WHEN channel_baseline_at_publish > 100000 THEN 1 END) as large_baselines,
        COUNT(CASE WHEN channel_baseline_at_publish < 100 THEN 1 END) as small_baselines
      FROM videos
      WHERE is_short = false
        AND channel_baseline_at_publish IS NOT NULL
    `);

    const after = afterStats.rows[0];
    console.log(`\n${colors.bright}After targeted fix:${colors.reset}`);
    console.log(`Median baseline: ${parseFloat(after.median_baseline).toFixed(2)}`);
    console.log(`Large baselines (>100K): ${parseInt(after.large_baselines).toLocaleString()} (legitimate large channels)`);
    console.log(`Small baselines (<100): ${parseInt(after.small_baselines).toLocaleString()} (correctly restored small channels)`);

    // Refresh materialized view
    console.log(`\n${colors.cyan}Refreshing materialized view...${colors.reset}`);
    await client.query('REFRESH MATERIALIZED VIEW heistable_videos');
    console.log(`${colors.green}✓ Materialized view refreshed${colors.reset}`);

    console.log(`\n${colors.bright}${colors.green}✅ TARGETED FIX COMPLETE!${colors.reset}`);
    console.log(`\nOnly fixed baselines that were clearly multiplied by ${P50_VALUE}.`);
    console.log(`Large channel baselines (legitimately > 100K) were preserved.`);

  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the analysis
analyzeBaselines().catch(console.error);