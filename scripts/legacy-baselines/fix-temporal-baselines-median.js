#!/usr/bin/env node

/**
 * Fix ALL Temporal Baselines with MEDIAN Calculation
 * 
 * Matches the database function exactly:
 * 1. Get last 10 videos from channel that were 30+ days old at publication
 * 2. For those videos, get their Day 30 views (using backfill if needed)
 * 3. Take the MEDIAN (not average) as the baseline
 * 
 * This bypasses the database function for performance
 */

import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function calculateMedian(values) {
  if (values.length === 0) return 1.0;
  
  const sorted = values.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    // Even number of values - average the two middle ones
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    // Odd number of values - take the middle one
    return sorted[mid];
  }
}

async function fixAllBaselines() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  const client = await pool.connect();

  const startTime = Date.now();
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  try {
    console.log(`${colors.cyan}Connecting to database...${colors.reset}`);
    await client.connect();

    // Get current state
    console.log(`\n${colors.yellow}Checking current state...${colors.reset}`);
    const stats = await client.query(`
      SELECT 
        COUNT(*) as total_videos,
        COUNT(CASE WHEN is_short = false THEN 1 END) as regular_videos,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as median_baseline
      FROM videos
    `);

    console.log(`Total videos: ${parseInt(stats.rows[0].total_videos).toLocaleString()}`);
    console.log(`Regular videos (non-Shorts): ${parseInt(stats.rows[0].regular_videos).toLocaleString()}`);
    console.log(`Current median baseline: ${colors.yellow}${parseFloat(stats.rows[0].median_baseline).toFixed(2)}${colors.reset}`);

    // Get global Day 30 P50 for backfill calculations
    console.log(`\n${colors.cyan}Getting global performance envelope...${colors.reset}`);
    const envelopeResult = await client.query(`
      SELECT p50_views as day30_p50
      FROM performance_envelopes
      WHERE day_since_published = 30
    `);

    if (!envelopeResult.rows.length) {
      throw new Error('No Day 30 envelope data found!');
    }

    const day30GlobalP50 = parseFloat(envelopeResult.rows[0].day30_p50);
    console.log(`Global P50 at Day 30: ${day30GlobalP50.toLocaleString()} views`);

    console.log(`\n${colors.yellow}⚠️  This will recalculate ALL temporal baselines using MEDIAN${colors.reset}`);
    console.log(`Press Ctrl+C to cancel, or wait 5 seconds to proceed...`);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Process all non-Short videos
    console.log(`\n${colors.cyan}Processing all regular videos...${colors.reset}`);
    
    // Get all regular videos ordered by channel and date
    const allVideos = await client.query(`
      SELECT id, channel_id, published_at, view_count
      FROM videos
      WHERE is_short = false
      ORDER BY channel_id, published_at
    `);

    console.log(`Found ${allVideos.rows.length.toLocaleString()} regular videos to process\n`);

    // Process in batches to show progress
    const batchSize = 1000;
    const updates = [];
    
    for (let i = 0; i < allVideos.rows.length; i++) {
      const video = allVideos.rows[i];
      
      // Get last 10 videos from same channel that were 30+ days old at publication
      const channelHistory = await client.query(`
        WITH historical_videos AS (
          SELECT 
            v.id,
            v.view_count as current_views,
            v.published_at,
            DATE_PART('day', $2::TIMESTAMPTZ - v.published_at) as age_when_target_published,
            DATE_PART('day', NOW() - v.published_at) as current_age,
            -- Try to get actual Day 30 snapshot
            (SELECT vs.view_count 
             FROM view_snapshots vs 
             WHERE vs.video_id = v.id 
               AND vs.days_since_published BETWEEN 28 AND 32
             ORDER BY ABS(vs.days_since_published - 30)
             LIMIT 1) as day30_snapshot,
            pe30.p50_views as envelope_at_day30,
            pe_current.p50_views as envelope_at_current_age
          FROM videos v
          LEFT JOIN performance_envelopes pe30 
            ON pe30.day_since_published = 30
          LEFT JOIN performance_envelopes pe_current 
            ON pe_current.day_since_published = LEAST(DATE_PART('day', NOW() - v.published_at)::INTEGER, 3650)
          WHERE v.channel_id = $1
            AND v.published_at < $2::TIMESTAMPTZ - INTERVAL '30 days'  -- Must be 30+ days old at publication
            AND v.is_short = false
            AND v.view_count > 0
          ORDER BY v.published_at DESC
          LIMIT 10
        )
        SELECT * FROM historical_videos
      `, [video.channel_id, video.published_at]);

      let baseline = 1.0;
      
      if (channelHistory.rows.length >= 3) {
        // Calculate Day 30 views for each historical video
        const day30Views = [];
        
        for (const hist of channelHistory.rows) {
          let day30Value;
          
          if (hist.day30_snapshot) {
            // Use actual Day 30 snapshot if available
            day30Value = parseFloat(hist.day30_snapshot);
          } else {
            // Use backfill formula
            const currentViews = parseFloat(hist.current_views);
            const envelopeAtCurrentAge = parseFloat(hist.envelope_at_current_age || day30GlobalP50);
            const envelopeAtDay30 = parseFloat(hist.envelope_at_day30 || day30GlobalP50);
            
            if (envelopeAtCurrentAge > 0) {
              day30Value = currentViews * (envelopeAtDay30 / envelopeAtCurrentAge);
            } else {
              day30Value = currentViews; // Fallback
            }
          }
          
          if (day30Value > 0 && !isNaN(day30Value)) {
            day30Views.push(day30Value);
          }
        }
        
        if (day30Views.length > 0) {
          // Calculate MEDIAN (matching database function)
          baseline = calculateMedian(day30Views);
        }
      } else if (channelHistory.rows.length > 0) {
        // Less than 3 videos, but at least 1 - still calculate median
        const day30Views = [];
        
        for (const hist of channelHistory.rows) {
          let day30Value;
          
          if (hist.day30_snapshot) {
            day30Value = parseFloat(hist.day30_snapshot);
          } else {
            const currentViews = parseFloat(hist.current_views);
            const envelopeAtCurrentAge = parseFloat(hist.envelope_at_current_age || day30GlobalP50);
            const envelopeAtDay30 = parseFloat(hist.envelope_at_day30 || day30GlobalP50);
            
            if (envelopeAtCurrentAge > 0) {
              day30Value = currentViews * (envelopeAtDay30 / envelopeAtCurrentAge);
            } else {
              day30Value = currentViews;
            }
          }
          
          if (day30Value > 0 && !isNaN(day30Value)) {
            day30Views.push(day30Value);
          }
        }
        
        if (day30Views.length > 0) {
          baseline = calculateMedian(day30Views);
        }
      }
      // If no history, baseline stays at 1.0
      
      // Calculate temporal performance score
      const score = video.view_count > 0 && baseline > 0 
        ? parseFloat(video.view_count) / baseline 
        : null;
      
      // Cap values to prevent overflow
      const cappedScore = score > 99999.999 ? 99999.999 : score;
      
      updates.push({
        id: video.id,
        baseline: baseline,
        score: cappedScore
      });
      
      totalProcessed++;
      
      // Update database in batches
      if (updates.length >= batchSize || i === allVideos.rows.length - 1) {
        const values = updates.map(u => 
          `('${u.id}', ${u.baseline.toFixed(3)}, ${u.score !== null ? u.score.toFixed(3) : 'NULL'})`
        ).join(',');
        
        await client.query(`
          UPDATE videos 
          SET 
            channel_baseline_at_publish = updates.baseline::NUMERIC,
            temporal_performance_score = updates.score::NUMERIC
          FROM (VALUES ${values}) AS updates(id, baseline, score)
          WHERE videos.id = updates.id::TEXT
        `);
        
        totalUpdated += updates.length;
        updates.length = 0; // Clear array
        
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (totalProcessed / elapsed).toFixed(1);
        process.stdout.write(`\r${colors.green}Processed ${totalProcessed.toLocaleString()} videos (${rate} videos/sec)...${colors.reset}`);
      }
    }

    console.log(`\n\n${colors.green}✓ Processing complete!${colors.reset}`);

    // Verify results
    console.log(`\n${colors.yellow}Verifying results...${colors.reset}`);
    const afterStats = await client.query(`
      SELECT 
        COUNT(*) as total_videos,
        COUNT(CASE WHEN channel_baseline_at_publish IS NOT NULL THEN 1 END) as with_baseline,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as median_baseline,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as p25,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as p75,
        AVG(temporal_performance_score) as avg_score,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY temporal_performance_score) as median_score
      FROM videos
      WHERE is_short = false
    `);

    const after = afterStats.rows[0];
    console.log(`\n${colors.bright}AFTER RECALCULATION:${colors.reset}`);
    console.log(`Videos with baselines: ${parseInt(after.with_baseline).toLocaleString()}`);
    console.log(`Median baseline: ${colors.green}${parseFloat(after.median_baseline).toLocaleString()}${colors.reset} views`);
    console.log(`25th percentile: ${parseFloat(after.p25).toLocaleString()} views`);
    console.log(`75th percentile: ${parseFloat(after.p75).toLocaleString()} views`);
    console.log(`Average performance score: ${parseFloat(after.avg_score).toFixed(2)}x`);
    console.log(`Median performance score: ${parseFloat(after.median_score).toFixed(2)}x`);

    // Show some examples
    console.log(`\n${colors.yellow}Example channels after fix:${colors.reset}`);
    const examples = await client.query(`
      SELECT 
        channel_name,
        COUNT(*) as video_count,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as median_baseline,
        AVG(temporal_performance_score) as avg_score
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
      console.log(`  ${row.channel_name}: ${parseFloat(row.median_baseline).toLocaleString()} views (${row.video_count} videos, ${parseFloat(row.avg_score).toFixed(2)}x avg score)`);
    });

    // Test Will Tennyson specifically
    const willTest = await client.query(`
      SELECT 
        title,
        view_count,
        channel_baseline_at_publish,
        temporal_performance_score
      FROM videos
      WHERE channel_name = 'Will Tennyson'
        AND is_short = false
      ORDER BY published_at DESC
      LIMIT 5
    `);

    console.log(`\n${colors.cyan}Will Tennyson videos after fix:${colors.reset}`);
    willTest.rows.forEach(row => {
      console.log(`  "${row.title.substring(0, 40)}..."`);
      console.log(`    Views: ${parseInt(row.view_count).toLocaleString()}, Baseline: ${colors.green}${parseFloat(row.channel_baseline_at_publish).toLocaleString()}${colors.reset}, Score: ${parseFloat(row.temporal_performance_score).toFixed(2)}x`);
    });

    // Refresh materialized view
    console.log(`\n${colors.cyan}Refreshing materialized view...${colors.reset}`);
    await client.query('REFRESH MATERIALIZED VIEW heistable_videos');
    console.log(`${colors.green}✓ Materialized view refreshed${colors.reset}`);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const finalRate = (totalProcessed / totalTime).toFixed(1);
    
    console.log(`\n${colors.bright}${colors.green}✅ ALL BASELINES FIXED!${colors.reset}`);
    console.log(`\nProcessed ${totalProcessed.toLocaleString()} videos in ${totalTime} seconds (${finalRate} videos/sec)`);
    console.log(`\nBaselines now correctly use:`);
    console.log(`1. Only videos 30+ days old at publication time`);
    console.log(`2. Their Day 30 views (actual or backfilled)`);
    console.log(`3. ${colors.bright}MEDIAN${colors.reset} (not average) as the baseline`);

  } catch (error) {
    console.error(`\n${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the fix
fixAllBaselines().catch(console.error);