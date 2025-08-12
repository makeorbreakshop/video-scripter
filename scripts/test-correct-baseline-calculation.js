#!/usr/bin/env node

/**
 * TEST - Correct Baseline Calculation
 * 
 * Based on the actual implementation from dev logs:
 * 1. Get last 10 videos from channel (published within 30 days before target)
 * 2. Estimate their Day 30 views using global performance curves
 * 3. Take the AVERAGE of those Day 30 estimates
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

async function testCorrectCalculation() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log(`${colors.cyan}Connecting to database...${colors.reset}`);
    await client.connect();

    // Get global performance envelope Day 30 value
    console.log(`\n${colors.cyan}Getting global performance envelope for Day 30...${colors.reset}`);
    const envelopeResult = await client.query(`
      SELECT p50_views as day30_p50
      FROM performance_envelopes
      WHERE day_since_published = 30
    `);

    if (!envelopeResult.rows.length) {
      throw new Error('No Day 30 envelope data found!');
    }

    const day30GlobalP50 = parseFloat(envelopeResult.rows[0].day30_p50);
    console.log(`Global P50 at Day 30: ${colors.green}${day30GlobalP50.toLocaleString()}${colors.reset} views`);

    // Test on specific known channels
    const testChannels = [
      'MKBHD',
      'Will Tennyson',
      'Make or Break Shop'
    ];

    console.log(`\n${colors.yellow}Testing correct calculation on ${testChannels.length} channels...${colors.reset}\n`);

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
        LIMIT 3
      `, [channelName]);

      if (videos.rows.length === 0) {
        console.log(`  No videos found for ${channelName}\n`);
        continue;
      }

      for (const video of videos.rows) {
        console.log(`\n  ${colors.cyan}Video: ${video.title.substring(0, 50)}...${colors.reset}`);
        console.log(`  Published: ${new Date(video.published_at).toLocaleDateString()} (${Math.round(video.age_days)} days ago)`);
        console.log(`  Current views: ${parseInt(video.view_count).toLocaleString()}`);
        console.log(`  Current baseline: ${colors.yellow}${parseFloat(video.current_baseline || 0).toLocaleString()}${colors.reset}`);

        // Get last 10 videos from same channel WITHIN 30 DAYS before this video
        const channelHistory = await client.query(`
          SELECT 
            v.title,
            v.view_count,
            v.published_at,
            DATE_PART('day', $2::TIMESTAMPTZ - v.published_at) as days_before_target,
            DATE_PART('day', NOW() - v.published_at) as current_age,
            pe_current.p50_views as envelope_at_current_age,
            pe_30.p50_views as envelope_at_day30
          FROM videos v
          LEFT JOIN performance_envelopes pe_current 
            ON pe_current.day_since_published = LEAST(DATE_PART('day', NOW() - v.published_at)::INTEGER, 3650)
          LEFT JOIN performance_envelopes pe_30
            ON pe_30.day_since_published = 30
          WHERE v.channel_id = $1
            AND v.published_at < $2
            AND v.published_at >= $2::TIMESTAMPTZ - INTERVAL '30 days'
            AND v.is_short = false
            AND v.view_count > 0
          ORDER BY v.published_at DESC
          LIMIT 10
        `, [video.channel_id, video.published_at]);

        console.log(`\n  ${colors.blue}Found ${channelHistory.rows.length} videos within 30 days before publication:${colors.reset}`);

        let baseline = 1.0;
        const day30Estimates = [];

        if (channelHistory.rows.length >= 3) {
          // Calculate Day 30 estimates for all historical videos
          for (let i = 0; i < channelHistory.rows.length; i++) {
            const hist = channelHistory.rows[i];
            const currentAge = parseInt(hist.current_age);
            const currentViews = parseInt(hist.view_count);
            const envelopeAtCurrentAge = parseFloat(hist.envelope_at_current_age || day30GlobalP50);
            const envelopeAtDay30 = parseFloat(hist.envelope_at_day30 || day30GlobalP50);
            
            // Estimate Day 30 views using backfill formula
            let day30Estimate;
            if (currentAge <= 30) {
              // Video is younger than 30 days, extrapolate forward
              day30Estimate = currentViews * (envelopeAtDay30 / envelopeAtCurrentAge);
            } else {
              // Video is older than 30 days, backfill to Day 30
              day30Estimate = currentViews * (envelopeAtDay30 / envelopeAtCurrentAge);
            }
            
            day30Estimates.push(day30Estimate);

            if (i < 3) {
              console.log(`    ${i+1}. "${hist.title.substring(0, 40)}..."`);
              console.log(`       Published ${Math.round(hist.days_before_target)} days before target`);
              console.log(`       Current: ${currentViews.toLocaleString()} views at ${currentAge} days old`);
              console.log(`       Day 30 estimate: ${colors.green}${Math.round(day30Estimate).toLocaleString()}${colors.reset}`);
            }
          }

          // Calculate AVERAGE (not median) of Day 30 estimates
          baseline = day30Estimates.reduce((sum, val) => sum + val, 0) / day30Estimates.length;
          
          console.log(`\n  ${colors.bright}Baseline Calculation:${colors.reset}`);
          console.log(`  Average of ${day30Estimates.length} Day 30 estimates: ${colors.green}${Math.round(baseline).toLocaleString()}${colors.reset}`);
        } else {
          console.log(`  ${colors.red}Not enough historical videos for baseline (need 3+)${colors.reset}`);
        }

        const newScore = video.view_count > 0 && baseline > 0 
          ? parseFloat(video.view_count) / baseline 
          : null;

        console.log(`  Temporal performance score: ${colors.green}${newScore?.toFixed(2)}x${colors.reset}`);
        
        if (video.current_baseline) {
          const baselineChange = ((baseline - video.current_baseline) / video.current_baseline * 100);
          console.log(`  Baseline change from current: ${baselineChange >= 0 ? '+' : ''}${baselineChange.toFixed(1)}%`);
        }
      }

      console.log('\n' + '─'.repeat(70) + '\n');
    }

    // Test on broader sample
    console.log(`${colors.yellow}Testing on random sample of 10 videos...${colors.reset}\n`);
    
    const sampleVideos = await client.query(`
      SELECT id, title, channel_name, channel_id, published_at, view_count,
             channel_baseline_at_publish as current_baseline
      FROM videos
      WHERE is_short = false
        AND view_count > 1000
        AND channel_baseline_at_publish IS NOT NULL
      ORDER BY RANDOM()
      LIMIT 10
    `);

    for (const video of sampleVideos.rows) {
      // Get historical videos within 30 days
      const channelHistory = await client.query(`
        SELECT 
          v.view_count,
          DATE_PART('day', NOW() - v.published_at) as current_age,
          pe_current.p50_views as envelope_at_current_age,
          pe_30.p50_views as envelope_at_day30
        FROM videos v
        LEFT JOIN performance_envelopes pe_current 
          ON pe_current.day_since_published = LEAST(DATE_PART('day', NOW() - v.published_at)::INTEGER, 3650)
        LEFT JOIN performance_envelopes pe_30
          ON pe_30.day_since_published = 30
        WHERE v.channel_id = $1
          AND v.published_at < $2
          AND v.published_at >= $2::TIMESTAMPTZ - INTERVAL '30 days'
          AND v.is_short = false
          AND v.view_count > 0
        ORDER BY v.published_at DESC
        LIMIT 10
      `, [video.channel_id, video.published_at]);

      if (channelHistory.rows.length >= 3) {
        const day30Estimates = channelHistory.rows.map(hist => {
          const currentViews = parseFloat(hist.view_count);
          const envelopeAtCurrentAge = parseFloat(hist.envelope_at_current_age || day30GlobalP50);
          const envelopeAtDay30 = parseFloat(hist.envelope_at_day30 || day30GlobalP50);
          return currentViews * (envelopeAtDay30 / envelopeAtCurrentAge);
        });

        const newBaseline = day30Estimates.reduce((sum, val) => sum + val, 0) / day30Estimates.length;
        const change = ((newBaseline - video.current_baseline) / video.current_baseline * 100);
        
        console.log(`${video.channel_name.substring(0, 25).padEnd(25)} | Current: ${parseFloat(video.current_baseline).toFixed(0).padStart(10)} | New: ${newBaseline.toFixed(0).padStart(10)} | Change: ${change >= 0 ? '+' : ''}${change.toFixed(1)}%`);
      }
    }

    console.log(`\n${colors.bright}${colors.green}✅ TEST COMPLETE!${colors.reset}`);
    console.log(`\nThis test uses the correct approach from the dev logs:`);
    console.log(`1. Get last 10 videos within 30 days before publication`);
    console.log(`2. Estimate their Day 30 views using global curves`);
    console.log(`3. Take the AVERAGE as the baseline`);

  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the test
testCorrectCalculation().catch(console.error);