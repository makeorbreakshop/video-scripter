#!/usr/bin/env node

/**
 * TEST VERSION - Fix Temporal Baselines with CORRECT Calculation
 * 
 * Tests on a small sample before running on entire database
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

async function testFixBaselines() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log(`${colors.cyan}Connecting to database...${colors.reset}`);
    await client.connect();

    // Get global Day 30 P50
    const envelopeResult = await client.query(`
      SELECT p50_views as day30_p50
      FROM performance_envelopes
      WHERE day_since_published = 30
    `);

    const day30GlobalP50 = parseFloat(envelopeResult.rows[0].day30_p50);
    console.log(`Global P50 at Day 30: ${day30GlobalP50.toLocaleString()} views`);

    // Test on Will Tennyson videos
    console.log(`\n${colors.yellow}Testing on Will Tennyson videos...${colors.reset}\n`);
    
    const willVideos = await client.query(`
      SELECT id, title, channel_id, published_at, view_count,
             channel_baseline_at_publish as current_baseline
      FROM videos
      WHERE channel_name = 'Will Tennyson'
        AND is_short = false
      ORDER BY published_at DESC
      LIMIT 5
    `);

    for (const video of willVideos.rows) {
      console.log(`${colors.cyan}Video: ${video.title.substring(0, 50)}...${colors.reset}`);
      console.log(`Current baseline: ${colors.red}${parseFloat(video.current_baseline).toLocaleString()}${colors.reset}`);
      
      // Get videos that were 30+ days old at publication
      const channelHistory = await client.query(`
        WITH historical_videos AS (
          SELECT 
            v.id,
            v.title,
            v.view_count as current_views,
            DATE_PART('day', $2::TIMESTAMPTZ - v.published_at) as age_when_target_published,
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
          LEFT JOIN performance_envelopes pe30 ON pe30.day_since_published = 30
          LEFT JOIN performance_envelopes pe_current 
            ON pe_current.day_since_published = LEAST(DATE_PART('day', NOW() - v.published_at)::INTEGER, 3650)
          WHERE v.channel_id = $1
            AND v.published_at < $2::TIMESTAMPTZ - INTERVAL '30 days'
            AND v.is_short = false
            AND v.view_count > 0
          ORDER BY v.published_at DESC
          LIMIT 10
        )
        SELECT * FROM historical_videos
      `, [video.channel_id, video.published_at]);

      console.log(`Found ${channelHistory.rows.length} videos 30+ days old at publication`);
      
      if (channelHistory.rows.length > 0) {
        const day30Views = [];
        
        // Show first 3 for debugging
        for (let i = 0; i < Math.min(3, channelHistory.rows.length); i++) {
          const hist = channelHistory.rows[i];
          let day30Value;
          
          if (hist.day30_snapshot) {
            day30Value = parseFloat(hist.day30_snapshot);
            console.log(`  ${i+1}. "${hist.title.substring(0, 30)}..." - Day 30: ${colors.green}${day30Value.toLocaleString()}${colors.reset} (actual)`);
          } else {
            const currentViews = parseFloat(hist.current_views);
            const envelopeAtCurrentAge = parseFloat(hist.envelope_at_current_age || day30GlobalP50);
            const envelopeAtDay30 = parseFloat(hist.envelope_at_day30 || day30GlobalP50);
            
            if (envelopeAtCurrentAge > 0) {
              day30Value = currentViews * (envelopeAtDay30 / envelopeAtCurrentAge);
              console.log(`  ${i+1}. "${hist.title.substring(0, 30)}..." - Day 30: ${colors.yellow}${Math.round(day30Value).toLocaleString()}${colors.reset} (backfill)`);
            }
          }
          
          if (day30Value > 0 && !isNaN(day30Value)) {
            day30Views.push(day30Value);
          }
        }
        
        // Calculate all for average
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
          const newBaseline = day30Views.reduce((sum, val) => sum + val, 0) / day30Views.length;
          console.log(`New baseline (AVERAGE): ${colors.green}${Math.round(newBaseline).toLocaleString()}${colors.reset}`);
          
          const change = ((newBaseline - video.current_baseline) / video.current_baseline * 100);
          console.log(`Change: ${change >= 0 ? '+' : ''}${change.toFixed(1)}%`);
        }
      }
      console.log('');
    }

    console.log(`\n${colors.bright}${colors.green}✅ TEST COMPLETE!${colors.reset}`);
    console.log(`\nIf these baselines look reasonable (should be much lower), run:`);
    console.log(`${colors.cyan}node scripts/fix-temporal-baselines-correct.js${colors.reset}`);

  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the test
testFixBaselines().catch(console.error);