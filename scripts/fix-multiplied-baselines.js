#!/usr/bin/env node

/**
 * Fix Multiplied Baselines
 * 
 * This script fixes the baseline multiplication error where all baselines
 * were incorrectly multiplied by 29,742. It divides them back to restore
 * the correct values.
 * 
 * The baselines should represent the median Day 30 views from the last 10 videos,
 * NOT multiplied by any P50 value.
 */

import pg from 'pg';
import dotenv from 'dotenv';

const { Client } = pg;
dotenv.config();

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

async function fixMultipliedBaselines() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log(`${colors.cyan}Connecting to database...${colors.reset}`);
    await client.connect();

    // First, check the current state
    console.log(`\n${colors.yellow}Checking current baseline state...${colors.reset}`);
    const beforeStats = await client.query(`
      SELECT 
        COUNT(*) as total_videos,
        MIN(channel_baseline_at_publish) as min_baseline,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as p25,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as median,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as p75,
        MAX(channel_baseline_at_publish) as max_baseline,
        COUNT(CASE WHEN channel_baseline_at_publish > 100 THEN 1 END) as inflated_count
      FROM videos
      WHERE is_short = false
        AND channel_baseline_at_publish IS NOT NULL
        AND channel_baseline_at_publish > 0
    `);

    const stats = beforeStats.rows[0];
    console.log(`\n${colors.bright}BEFORE FIX:${colors.reset}`);
    console.log(`Total videos: ${colors.yellow}${parseInt(stats.total_videos).toLocaleString()}${colors.reset}`);
    console.log(`Inflated baselines (>100): ${colors.red}${parseInt(stats.inflated_count).toLocaleString()}${colors.reset}`);
    console.log(`Min baseline: ${parseFloat(stats.min_baseline).toLocaleString()}`);
    console.log(`25th percentile: ${parseFloat(stats.p25).toLocaleString()}`);
    console.log(`Median baseline: ${colors.yellow}${parseFloat(stats.median).toLocaleString()}${colors.reset}`);
    console.log(`75th percentile: ${parseFloat(stats.p75).toLocaleString()}`);
    console.log(`Max baseline: ${colors.red}${parseFloat(stats.max_baseline).toLocaleString()}${colors.reset}`);

    // Check what the corrected values would look like
    console.log(`\n${colors.cyan}Calculating corrected values...${colors.reset}`);
    console.log(`Median would become: ${colors.green}${(parseFloat(stats.median) / 29742).toFixed(2)}${colors.reset}`);
    console.log(`Max would become: ${colors.green}${(parseFloat(stats.max_baseline) / 29742).toFixed(2)}${colors.reset}`);

    // Ask for confirmation
    console.log(`\n${colors.yellow}⚠️  This will divide ${stats.inflated_count} baselines by 29,742${colors.reset}`);
    console.log(`Press Ctrl+C to cancel, or wait 5 seconds to proceed...`);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Fix the baselines in batches
    console.log(`\n${colors.cyan}Fixing baselines in batches...${colors.reset}`);
    
    const batchSize = 5000;
    let totalFixed = 0;
    let batch = 1;

    while (true) {
      // Get a batch of videos to fix
      const batchResult = await client.query(`
        SELECT id, channel_baseline_at_publish, view_count
        FROM videos
        WHERE is_short = false
          AND channel_baseline_at_publish > 100
          AND channel_baseline_at_publish IS NOT NULL
        LIMIT ${batchSize}
      `);

      if (batchResult.rows.length === 0) {
        break;
      }

      // Build the update query with VALUES clause for efficiency
      const values = batchResult.rows.map(row => {
        const correctedBaseline = parseFloat(row.channel_baseline_at_publish) / 29742.0;
        let correctedScore = null;
        
        // Calculate score with safety checks
        if (row.view_count > 0 && correctedBaseline > 0) {
          correctedScore = parseFloat(row.view_count) / correctedBaseline;
          // Cap the score at 99999.999 to prevent overflow
          if (correctedScore > 99999.999) {
            correctedScore = 99999.999;
          }
        }
        
        return `('${row.id}', ${correctedBaseline.toFixed(3)}, ${correctedScore !== null ? correctedScore.toFixed(3) : 'NULL'})`;
      });

      // Update this batch
      await client.query(`
        UPDATE videos 
        SET 
          channel_baseline_at_publish = updates.baseline::NUMERIC,
          temporal_performance_score = updates.score::NUMERIC
        FROM (VALUES ${values.join(',')}) AS updates(id, baseline, score)
        WHERE videos.id = updates.id::TEXT
      `);

      totalFixed += batchResult.rows.length;
      process.stdout.write(`\r${colors.green}Fixed ${totalFixed.toLocaleString()} videos (batch ${batch})...${colors.reset}`);
      batch++;

      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n\n${colors.green}✓ Fixed ${totalFixed.toLocaleString()} videos${colors.reset}`);

    // Check the results
    console.log(`\n${colors.yellow}Verifying fix...${colors.reset}`);
    const afterStats = await client.query(`
      SELECT 
        COUNT(*) as total_videos,
        MIN(channel_baseline_at_publish) as min_baseline,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as p25,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as median,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as p75,
        MAX(channel_baseline_at_publish) as max_baseline,
        COUNT(CASE WHEN channel_baseline_at_publish > 100000 THEN 1 END) as still_high_count
      FROM videos
      WHERE is_short = false
        AND channel_baseline_at_publish IS NOT NULL
        AND channel_baseline_at_publish > 0
    `);

    const afterStatsData = afterStats.rows[0];
    console.log(`\n${colors.bright}AFTER FIX:${colors.reset}`);
    console.log(`Total videos: ${parseInt(afterStatsData.total_videos).toLocaleString()}`);
    console.log(`Min baseline: ${parseFloat(afterStatsData.min_baseline).toFixed(3)}`);
    console.log(`25th percentile: ${parseFloat(afterStatsData.p25).toFixed(3)}`);
    console.log(`Median baseline: ${colors.green}${parseFloat(afterStatsData.median).toFixed(3)}${colors.reset}`);
    console.log(`75th percentile: ${parseFloat(afterStatsData.p75).toFixed(3)}`);
    console.log(`Max baseline: ${parseFloat(afterStatsData.max_baseline).toFixed(3)}`);
    console.log(`Still > 100K: ${parseInt(afterStatsData.still_high_count).toLocaleString()} (these are legitimately large channels)`);

    // Refresh materialized view
    console.log(`\n${colors.cyan}Refreshing materialized view...${colors.reset}`);
    await client.query('REFRESH MATERIALIZED VIEW heistable_videos');
    console.log(`${colors.green}✓ Materialized view refreshed${colors.reset}`);

    // Show some example channels
    console.log(`\n${colors.yellow}Example channel baselines after fix:${colors.reset}`);
    const examples = await client.query(`
      SELECT 
        channel_name,
        COUNT(*) as video_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as median_baseline
      FROM videos
      WHERE is_short = false
        AND channel_baseline_at_publish IS NOT NULL
      GROUP BY channel_name
      HAVING COUNT(*) > 10
      ORDER BY median_baseline DESC
      LIMIT 10
    `);

    console.log(`\nTop 10 channels by median baseline:`);
    examples.rows.forEach(row => {
      console.log(`  ${row.channel_name}: ${parseFloat(row.median_baseline).toLocaleString()} views (${row.video_count} videos)`);
    });

    console.log(`\n${colors.bright}${colors.green}✅ BASELINE FIX COMPLETE!${colors.reset}`);
    console.log(`\nThe baselines now represent the actual median Day 30 views from the last 10 videos.`);
    console.log(`Performance scores have been recalculated accordingly.`);

  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the fix
fixMultipliedBaselines().catch(console.error);