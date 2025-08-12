#!/usr/bin/env node

/**
 * Recalculate ALL Temporal Baselines
 * 
 * This script recalculates channel_baseline_at_publish for all videos
 * using the CORRECT method:
 * 1. Find last 10 videos from channel before publication
 * 2. Use global performance curves to estimate their Day 30 views
 * 3. Take the MEDIAN of those Day 30 estimates
 * 4. Calculate temporal_performance_score = view_count / baseline
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

async function recalculateAllBaselines() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log(`${colors.cyan}Connecting to database...${colors.reset}`);
    await client.connect();

    // First, check current state
    console.log(`\n${colors.yellow}Checking current state...${colors.reset}`);
    const stats = await client.query(`
      SELECT 
        COUNT(*) as total_videos,
        COUNT(CASE WHEN channel_baseline_at_publish IS NOT NULL THEN 1 END) as with_baseline,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY channel_baseline_at_publish) as median_baseline,
        COUNT(CASE WHEN is_short = false THEN 1 END) as regular_videos
      FROM videos
    `);

    console.log(`Total videos: ${parseInt(stats.rows[0].total_videos).toLocaleString()}`);
    console.log(`Regular videos (non-Shorts): ${parseInt(stats.rows[0].regular_videos).toLocaleString()}`);
    console.log(`Current median baseline: ${parseFloat(stats.rows[0].median_baseline).toFixed(2)}`);

    // Get global performance envelope Day 30 value
    console.log(`\n${colors.cyan}Getting global performance envelope for Day 30...${colors.reset}`);
    const envelopeResult = await client.query(`
      SELECT p50_views as day30_p50
      FROM performance_envelopes
      WHERE day_since_published = 30
    `);

    if (!envelopeResult.rows.length) {
      throw new Error('No Day 30 envelope data found! Run envelope recalculation first.');
    }

    const day30GlobalP50 = parseFloat(envelopeResult.rows[0].day30_p50);
    console.log(`Global P50 at Day 30: ${day30GlobalP50.toLocaleString()} views`);

    console.log(`\n${colors.yellow}⚠️  This will recalculate ALL temporal baselines using the correct method${colors.reset}`);
    console.log(`Press Ctrl+C to cancel, or wait 5 seconds to proceed...`);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Process in batches to avoid memory issues
    console.log(`\n${colors.cyan}Processing videos in batches...${colors.reset}`);
    
    const batchSize = 1000;
    let offset = 0;
    let totalProcessed = 0;
    let totalUpdated = 0;

    while (true) {
      // Get batch of videos
      const batch = await client.query(`
        SELECT id, channel_id, published_at, view_count,
               DATE_PART('day', NOW() - published_at) as age_days
        FROM videos
        WHERE is_short = false
        ORDER BY channel_id, published_at DESC
        LIMIT ${batchSize} OFFSET ${offset}
      `);

      if (batch.rows.length === 0) break;

      // Process each video in the batch
      const updates = [];
      
      for (const video of batch.rows) {
        // Get last 10 videos from same channel before this video
        const channelHistory = await client.query(`
          SELECT 
            v.view_count,
            DATE_PART('day', $2::TIMESTAMPTZ - v.published_at) as age_at_target_publish,
            pe.p50_views as envelope_at_age
          FROM videos v
          LEFT JOIN performance_envelopes pe 
            ON pe.day_since_published = DATE_PART('day', $2::TIMESTAMPTZ - v.published_at)::INTEGER
          WHERE v.channel_id = $1
            AND v.published_at < $2
            AND v.is_short = false
            AND v.view_count > 0
          ORDER BY v.published_at DESC
          LIMIT 10
        `, [video.channel_id, video.published_at]);

        let baseline = 1.0; // Default if no history
        
        if (channelHistory.rows.length >= 3) { // Need at least 3 videos for meaningful median
          // Calculate Day 30 estimates for each historical video
          const day30Estimates = channelHistory.rows.map(hist => {
            const ageAtPublish = parseInt(hist.age_at_target_publish);
            const currentViews = parseFloat(hist.view_count);
            const envelopeAtAge = parseFloat(hist.envelope_at_age || 1);
            
            // Use backfill formula to estimate Day 30 views
            if (ageAtPublish < 30) {
              // Video was less than 30 days old, extrapolate forward
              return currentViews * (day30GlobalP50 / Math.max(envelopeAtAge, 1));
            } else {
              // Video was older than 30 days, backfill to Day 30
              const day30Envelope = day30GlobalP50;
              const currentEnvelope = envelopeAtAge || day30GlobalP50;
              return currentViews * (day30Envelope / Math.max(currentEnvelope, 1));
            }
          }).filter(est => est > 0 && !isNaN(est));

          if (day30Estimates.length > 0) {
            // Calculate median of Day 30 estimates
            day30Estimates.sort((a, b) => a - b);
            const mid = Math.floor(day30Estimates.length / 2);
            baseline = day30Estimates.length % 2 !== 0
              ? day30Estimates[mid]
              : (day30Estimates[mid - 1] + day30Estimates[mid]) / 2;
          }
        }

        // Calculate temporal performance score
        const score = video.view_count > 0 && baseline > 0 
          ? parseFloat(video.view_count) / baseline 
          : null;

        // Cap values to prevent database overflow
        if (score > 99999.999) {
          score = 99999.999;
        }

        updates.push({
          id: video.id,
          baseline: baseline,
          score: score
        });
      }

      // Update database in single query
      if (updates.length > 0) {
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
      }

      totalProcessed += batch.rows.length;
      process.stdout.write(`\r${colors.green}Processed ${totalProcessed.toLocaleString()} videos, updated ${totalUpdated.toLocaleString()}...${colors.reset}`);
      
      offset += batchSize;
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
        AVG(temporal_performance_score) as avg_score
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

    // Show some examples
    console.log(`\n${colors.yellow}Example channels after recalculation:${colors.reset}`);
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

    // Refresh materialized view
    console.log(`\n${colors.cyan}Refreshing materialized view...${colors.reset}`);
    await client.query('REFRESH MATERIALIZED VIEW heistable_videos');
    console.log(`${colors.green}✓ Materialized view refreshed${colors.reset}`);

    console.log(`\n${colors.bright}${colors.green}✅ RECALCULATION COMPLETE!${colors.reset}`);
    console.log(`\nTemporal baselines now correctly represent the median Day 30 performance`);
    console.log(`from the last 10 videos, using global performance curve backfill.`);

  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the recalculation
recalculateAllBaselines().catch(console.error);