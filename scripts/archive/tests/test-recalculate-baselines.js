#!/usr/bin/env node

/**
 * TEST VERSION - Recalculate Temporal Baselines
 * 
 * Tests the baseline calculation on a small sample to verify correctness
 * before running on entire database
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

async function testRecalculation() {
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
      throw new Error('No Day 30 envelope data found! Run envelope recalculation first.');
    }

    const day30GlobalP50 = parseFloat(envelopeResult.rows[0].day30_p50);
    console.log(`Global P50 at Day 30: ${colors.green}${day30GlobalP50.toLocaleString()}${colors.reset} views`);

    // Test on specific known channels
    const testChannels = [
      'MKBHD',
      'Will Tennyson',
      'Make or Break Shop'
    ];

    console.log(`\n${colors.yellow}Testing on ${testChannels.length} channels...${colors.reset}\n`);

    for (const channelName of testChannels) {
      console.log(`${colors.bright}${colors.magenta}Testing channel: ${channelName}${colors.reset}`);
      console.log('─'.repeat(60));

      // Get a few videos from this channel
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
        console.log(`  Current score: ${colors.yellow}${parseFloat(video.current_score || 0).toFixed(2)}x${colors.reset}`);

        // Calculate new baseline using last 10 videos
        const channelHistory = await client.query(`
          SELECT 
            v.title,
            v.view_count,
            v.published_at,
            DATE_PART('day', $2::TIMESTAMPTZ - v.published_at) as age_at_target_publish,
            DATE_PART('day', NOW() - v.published_at) as current_age,
            pe_current.p50_views as envelope_at_current_age,
            pe_30.p50_views as envelope_at_day30
          FROM videos v
          LEFT JOIN performance_envelopes pe_current 
            ON pe_current.day_since_published = DATE_PART('day', NOW() - v.published_at)::INTEGER
          LEFT JOIN performance_envelopes pe_30
            ON pe_30.day_since_published = 30
          WHERE v.channel_id = $1
            AND v.published_at < $2
            AND v.is_short = false
            AND v.view_count > 0
          ORDER BY v.published_at DESC
          LIMIT 10
        `, [video.channel_id, video.published_at]);

        console.log(`\n  ${colors.blue}Found ${channelHistory.rows.length} historical videos:${colors.reset}`);

        let baseline = 1.0;
        const day30Estimates = [];

        if (channelHistory.rows.length >= 3) {
          // Show details for first 3 videos
          for (let i = 0; i < Math.min(3, channelHistory.rows.length); i++) {
            const hist = channelHistory.rows[i];
            const currentAge = parseInt(hist.current_age);
            const currentViews = parseInt(hist.view_count);
            const envelopeAtCurrentAge = parseFloat(hist.envelope_at_current_age || 1);
            const envelopeAtDay30 = parseFloat(hist.envelope_at_day30 || day30GlobalP50);
            
            // Calculate Day 30 estimate using backfill
            const day30Estimate = currentViews * (envelopeAtDay30 / Math.max(envelopeAtCurrentAge, 1));
            day30Estimates.push(day30Estimate);

            console.log(`    ${i+1}. "${hist.title.substring(0, 40)}..."`);
            console.log(`       Age: ${currentAge} days, Views: ${currentViews.toLocaleString()}`);
            console.log(`       Envelope at age ${currentAge}: ${envelopeAtCurrentAge.toFixed(0)}`);
            console.log(`       Backfill to Day 30: ${currentViews.toLocaleString()} × (${envelopeAtDay30.toFixed(0)} / ${envelopeAtCurrentAge.toFixed(0)}) = ${colors.green}${Math.round(day30Estimate).toLocaleString()}${colors.reset}`);
          }

          // Calculate all estimates for median
          const allEstimates = channelHistory.rows.map(hist => {
            const currentViews = parseFloat(hist.view_count);
            const envelopeAtCurrentAge = parseFloat(hist.envelope_at_current_age || 1);
            const envelopeAtDay30 = parseFloat(hist.envelope_at_day30 || day30GlobalP50);
            return currentViews * (envelopeAtDay30 / Math.max(envelopeAtCurrentAge, 1));
          }).filter(est => est > 0 && !isNaN(est));

          if (allEstimates.length > 0) {
            // Calculate median
            allEstimates.sort((a, b) => a - b);
            const mid = Math.floor(allEstimates.length / 2);
            baseline = allEstimates.length % 2 !== 0
              ? allEstimates[mid]
              : (allEstimates[mid - 1] + allEstimates[mid]) / 2;
          }
        }

        const newScore = video.view_count > 0 && baseline > 0 
          ? parseFloat(video.view_count) / baseline 
          : null;

        console.log(`\n  ${colors.bright}NEW CALCULATION:${colors.reset}`);
        console.log(`  New baseline (median of Day 30 estimates): ${colors.green}${Math.round(baseline).toLocaleString()}${colors.reset}`);
        console.log(`  New score: ${colors.green}${newScore.toFixed(2)}x${colors.reset}`);
        
        const baselineChange = ((baseline - (video.current_baseline || 1)) / (video.current_baseline || 1) * 100);
        console.log(`  Change: ${baselineChange >= 0 ? '+' : ''}${baselineChange.toFixed(1)}%`);
      }

      console.log('\n' + '─'.repeat(60) + '\n');
    }

    // Test on a broader sample
    console.log(`${colors.yellow}Testing calculation on random sample of 20 videos...${colors.reset}\n`);
    
    const sampleVideos = await client.query(`
      SELECT id, title, channel_name, channel_id, published_at, view_count,
             channel_baseline_at_publish as current_baseline,
             temporal_performance_score as current_score
      FROM videos
      WHERE is_short = false
        AND view_count > 1000
        AND channel_baseline_at_publish IS NOT NULL
      ORDER BY RANDOM()
      LIMIT 20
    `);

    let totalBaselineBefore = 0;
    let totalBaselineAfter = 0;
    let count = 0;

    for (const video of sampleVideos.rows) {
      const channelHistory = await client.query(`
        SELECT 
          v.view_count,
          pe_current.p50_views as envelope_at_current_age,
          pe_30.p50_views as envelope_at_day30
        FROM videos v
        LEFT JOIN performance_envelopes pe_current 
          ON pe_current.day_since_published = DATE_PART('day', NOW() - v.published_at)::INTEGER
        LEFT JOIN performance_envelopes pe_30
          ON pe_30.day_since_published = 30
        WHERE v.channel_id = $1
          AND v.published_at < $2
          AND v.is_short = false
          AND v.view_count > 0
        ORDER BY v.published_at DESC
        LIMIT 10
      `, [video.channel_id, video.published_at]);

      if (channelHistory.rows.length >= 3) {
        const allEstimates = channelHistory.rows.map(hist => {
          const currentViews = parseFloat(hist.view_count);
          const envelopeAtCurrentAge = parseFloat(hist.envelope_at_current_age || 1);
          const envelopeAtDay30 = parseFloat(hist.envelope_at_day30 || day30GlobalP50);
          return currentViews * (envelopeAtDay30 / Math.max(envelopeAtCurrentAge, 1));
        }).filter(est => est > 0 && !isNaN(est));

        if (allEstimates.length > 0) {
          allEstimates.sort((a, b) => a - b);
          const mid = Math.floor(allEstimates.length / 2);
          const newBaseline = allEstimates.length % 2 !== 0
            ? allEstimates[mid]
            : (allEstimates[mid - 1] + allEstimates[mid]) / 2;

          totalBaselineBefore += parseFloat(video.current_baseline || 1);
          totalBaselineAfter += newBaseline;
          count++;

          const change = ((newBaseline - (video.current_baseline || 1)) / (video.current_baseline || 1) * 100);
          console.log(`${video.channel_name.substring(0, 20).padEnd(20)} | Before: ${parseFloat(video.current_baseline).toFixed(0).padStart(10)} | After: ${newBaseline.toFixed(0).padStart(10)} | Change: ${change >= 0 ? '+' : ''}${change.toFixed(1)}%`);
        }
      }
    }

    if (count > 0) {
      const avgBefore = totalBaselineBefore / count;
      const avgAfter = totalBaselineAfter / count;
      const avgChange = ((avgAfter - avgBefore) / avgBefore * 100);

      console.log(`\n${colors.bright}SUMMARY:${colors.reset}`);
      console.log(`Average baseline before: ${avgBefore.toFixed(0).toLocaleString()}`);
      console.log(`Average baseline after: ${avgAfter.toFixed(0).toLocaleString()}`);
      console.log(`Average change: ${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(1)}%`);
    }

    console.log(`\n${colors.bright}${colors.green}✅ TEST COMPLETE!${colors.reset}`);
    console.log(`\nIf these numbers look reasonable, run the full recalculation with:`);
    console.log(`${colors.cyan}node scripts/recalculate-all-temporal-baselines.js${colors.reset}`);

  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the test
testRecalculation().catch(console.error);