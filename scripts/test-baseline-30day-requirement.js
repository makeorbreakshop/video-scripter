#!/usr/bin/env node

/**
 * TEST - Baseline Calculation with 30-Day Requirement
 * 
 * Correct approach from August 7-8 work:
 * 1. Get last 10 videos from channel
 * 2. ONLY use videos that were already 30+ days old at target video's publication
 * 3. Use their ACTUAL views at Day 30 (not current views with backfill)
 * 4. Take the AVERAGE as the baseline
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
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

async function testBaseline30DayRequirement() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log(`${colors.cyan}Connecting to database...${colors.reset}`);
    await client.connect();

    // Test on specific known channels
    const testChannels = [
      'Will Tennyson',
      'MKBHD',
      'Make or Break Shop'
    ];

    console.log(`\n${colors.yellow}Testing baseline calculation with 30-day requirement...${colors.reset}\n`);

    for (const channelName of testChannels) {
      console.log(`${colors.bright}${colors.magenta}Channel: ${channelName}${colors.reset}`);
      console.log('─'.repeat(70));

      // Get recent videos from this channel
      const videos = await client.query(`
        SELECT id, title, channel_id, published_at, view_count,
               channel_baseline_at_publish as current_baseline,
               temporal_performance_score as current_score,
               DATE_PART('day', NOW() - published_at) as age_days
        FROM videos
        WHERE channel_name = $1
          AND is_short = false
          AND view_count > 0
        ORDER BY published_at DESC
        LIMIT 2
      `, [channelName]);

      if (videos.rows.length === 0) {
        console.log(`  No videos found for ${channelName}\n`);
        continue;
      }

      for (const video of videos.rows) {
        console.log(`\n  ${colors.cyan}Video: ${video.title.substring(0, 50)}...${colors.reset}`);
        console.log(`  Published: ${new Date(video.published_at).toLocaleDateString()} (${Math.round(video.age_days)} days ago)`);
        console.log(`  Current views: ${parseInt(video.view_count).toLocaleString()}`);
        console.log(`  Current baseline in DB: ${colors.yellow}${parseFloat(video.current_baseline || 0).toLocaleString()}${colors.reset}`);

        // Get last 10 videos that were ALREADY 30+ days old when target was published
        // This means: (target.published_at - video.published_at) > 30 days
        const channelHistory = await client.query(`
          WITH historical_videos AS (
            SELECT 
              v.id,
              v.title,
              v.view_count as current_views,
              v.published_at,
              DATE_PART('day', $2::TIMESTAMPTZ - v.published_at) as age_when_target_published,
              -- Try to find a snapshot close to Day 30 for this video
              (SELECT vs.view_count 
               FROM view_snapshots vs 
               WHERE vs.video_id = v.id 
                 AND vs.days_since_published BETWEEN 28 AND 32
               ORDER BY ABS(vs.days_since_published - 30)
               LIMIT 1) as actual_day30_views
            FROM videos v
            WHERE v.channel_id = $1
              AND v.published_at < $2::TIMESTAMPTZ - INTERVAL '30 days'  -- Must be 30+ days old
              AND v.is_short = false
              AND v.view_count > 0
            ORDER BY v.published_at DESC
            LIMIT 10
          )
          SELECT * FROM historical_videos
        `, [video.channel_id, video.published_at]);

        console.log(`\n  ${colors.blue}Found ${channelHistory.rows.length} videos that were 30+ days old at publication:${colors.reset}`);

        if (channelHistory.rows.length === 0) {
          console.log(`  ${colors.red}No videos old enough for baseline calculation${colors.reset}`);
          console.log(`  This must be one of the first videos or a new channel`);
          continue;
        }

        const validDay30Views = [];
        
        for (let i = 0; i < Math.min(3, channelHistory.rows.length); i++) {
          const hist = channelHistory.rows[i];
          const ageWhenTargetPublished = Math.round(hist.age_when_target_published);
          
          console.log(`    ${i+1}. "${hist.title.substring(0, 40)}..."`);
          console.log(`       Was ${ageWhenTargetPublished} days old when target published`);
          
          if (hist.actual_day30_views) {
            console.log(`       Day 30 views: ${colors.green}${parseInt(hist.actual_day30_views).toLocaleString()}${colors.reset} (from snapshot)`);
            validDay30Views.push(parseFloat(hist.actual_day30_views));
          } else {
            // Need to estimate Day 30 views using backfill
            console.log(`       Current views: ${parseInt(hist.current_views).toLocaleString()}`);
            console.log(`       ${colors.yellow}No Day 30 snapshot available - would need backfill${colors.reset}`);
            // For now, use a simple estimate (this is where backfill would go)
            // In reality, this would use the performance envelope curves
          }
        }

        if (validDay30Views.length > 0) {
          const baseline = validDay30Views.reduce((sum, val) => sum + val, 0) / validDay30Views.length;
          console.log(`\n  ${colors.bright}Baseline Calculation:${colors.reset}`);
          console.log(`  Average of ${validDay30Views.length} Day 30 views: ${colors.green}${Math.round(baseline).toLocaleString()}${colors.reset}`);
          
          const newScore = video.view_count > 0 && baseline > 0 
            ? parseFloat(video.view_count) / baseline 
            : null;
          
          console.log(`  Temporal performance score: ${colors.green}${newScore?.toFixed(2)}x${colors.reset}`);
        } else {
          console.log(`\n  ${colors.red}No valid Day 30 data available for baseline calculation${colors.reset}`);
        }
      }

      console.log('\n' + '─'.repeat(70) + '\n');
    }

    // Check what the actual database function does
    console.log(`${colors.yellow}Checking actual database function implementation...${colors.reset}\n`);
    
    const functionDef = await client.query(`
      SELECT pg_get_functiondef(oid) as definition
      FROM pg_proc
      WHERE proname = 'calculate_video_channel_baseline'
    `);

    if (functionDef.rows.length > 0) {
      console.log(`${colors.cyan}Database function 'calculate_video_channel_baseline' exists${colors.reset}`);
      console.log(`Let's check what it actually does with the last 10 videos...`);
      // The function definition would show the actual implementation
    }

    console.log(`\n${colors.bright}${colors.green}✅ TEST COMPLETE!${colors.reset}`);
    console.log(`\nKey findings:`);
    console.log(`1. We should only use videos that were 30+ days old at publication time`);
    console.log(`2. We need their actual Day 30 views (from snapshots or backfill)`);
    console.log(`3. Take the AVERAGE as the baseline`);
    console.log(`\n${colors.yellow}Most videos don't have Day 30 snapshots, so backfill is required${colors.reset}`);

  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the test
testBaseline30DayRequirement().catch(console.error);