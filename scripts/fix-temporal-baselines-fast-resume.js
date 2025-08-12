#!/usr/bin/env node

/**
 * FAST Temporal Baseline Fix with Resume Support
 * 
 * Optimizations:
 * 1. Bulk fetch all channel history at once
 * 2. Cache performance envelope data
 * 3. Process in larger batches (5000)
 * 4. Resume from last processed video
 * 5. Parallel processing where possible
 */

import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

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

// Resume state file
const RESUME_FILE = path.join(process.cwd(), '.baseline-fix-resume.json');

function saveProgress(lastProcessedIndex, totalProcessed) {
  fs.writeFileSync(RESUME_FILE, JSON.stringify({
    lastProcessedIndex,
    totalProcessed,
    timestamp: new Date().toISOString()
  }));
}

function loadProgress() {
  if (fs.existsSync(RESUME_FILE)) {
    const data = JSON.parse(fs.readFileSync(RESUME_FILE, 'utf8'));
    console.log(`${colors.yellow}Found resume file from ${data.timestamp}${colors.reset}`);
    console.log(`Will resume from video index ${data.lastProcessedIndex}`);
    return data;
  }
  return null;
}

function calculateMedian(values) {
  if (values.length === 0) return 1.0;
  
  const sorted = values.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
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
  
  // Load resume state
  const resumeState = loadProgress();
  const startIndex = resumeState ? resumeState.lastProcessedIndex : 0;
  if (resumeState) {
    totalProcessed = resumeState.totalProcessed;
  }

  try {
    console.log(`${colors.cyan}Connected to database...${colors.reset}`);

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

    // OPTIMIZATION 1: Preload ALL performance envelope data into memory
    console.log(`\n${colors.cyan}Loading performance envelopes into memory...${colors.reset}`);
    const envelopeResult = await client.query(`
      SELECT day_since_published, p50_views
      FROM performance_envelopes
      WHERE day_since_published <= 3650
    `);
    
    const envelopeMap = new Map();
    envelopeResult.rows.forEach(row => {
      envelopeMap.set(row.day_since_published, parseFloat(row.p50_views));
    });
    
    const day30GlobalP50 = envelopeMap.get(30);
    console.log(`Loaded ${envelopeMap.size} envelope data points`);
    console.log(`Global P50 at Day 30: ${day30GlobalP50.toLocaleString()} views`);

    if (resumeState) {
      console.log(`\n${colors.yellow}RESUMING from index ${startIndex}${colors.reset}`);
    } else {
      console.log(`\n${colors.yellow}Starting fresh calculation${colors.reset}`);
    }
    
    console.log(`Press Ctrl+C to cancel (progress will be saved)...`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Process all non-Short videos
    console.log(`\n${colors.cyan}Loading all regular videos...${colors.reset}`);
    
    const allVideos = await client.query(`
      SELECT id, channel_id, published_at, view_count
      FROM videos
      WHERE is_short = false
      ORDER BY channel_id, published_at
      OFFSET $1
    `, [startIndex]);

    console.log(`Processing ${allVideos.rows.length.toLocaleString()} videos (starting from index ${startIndex})\n`);

    // OPTIMIZATION 2: Preload ALL channel histories in one massive query
    console.log(`${colors.cyan}Preloading channel histories (this may take a minute)...${colors.reset}`);
    
    const channelHistoryQuery = `
      WITH ranked_videos AS (
        SELECT 
          v1.id as target_id,
          v1.channel_id,
          v1.published_at as target_published,
          v2.id as history_id,
          v2.view_count as history_views,
          v2.published_at as history_published,
          DATE_PART('day', NOW() - v2.published_at) as current_age,
          ROW_NUMBER() OVER (
            PARTITION BY v1.id 
            ORDER BY v2.published_at DESC
          ) as rn,
          -- Get any Day 30 snapshots
          (SELECT vs.view_count 
           FROM view_snapshots vs 
           WHERE vs.video_id = v2.id 
             AND vs.days_since_published BETWEEN 28 AND 32
           ORDER BY ABS(vs.days_since_published - 30)
           LIMIT 1) as day30_snapshot
        FROM videos v1
        INNER JOIN videos v2 
          ON v2.channel_id = v1.channel_id
          AND v2.published_at < v1.published_at - INTERVAL '30 days'
          AND v2.is_short = false
          AND v2.view_count > 0
        WHERE v1.is_short = false
      )
      SELECT * FROM ranked_videos WHERE rn <= 10
    `;
    
    const historyResult = await client.query(channelHistoryQuery);
    
    // Build a map of video -> history
    const historyMap = new Map();
    historyResult.rows.forEach(row => {
      if (!historyMap.has(row.target_id)) {
        historyMap.set(row.target_id, []);
      }
      historyMap.get(row.target_id).push({
        current_views: parseFloat(row.history_views),
        current_age: parseInt(row.current_age),
        day30_snapshot: row.day30_snapshot ? parseFloat(row.day30_snapshot) : null
      });
    });
    
    console.log(`Loaded history for ${historyMap.size} videos`);

    // Process in larger batches for efficiency
    const batchSize = 5000;
    const updates = [];
    
    // Set up graceful shutdown
    let shouldStop = false;
    process.on('SIGINT', () => {
      console.log(`\n${colors.yellow}Gracefully stopping... Saving progress...${colors.reset}`);
      shouldStop = true;
    });
    
    for (let i = 0; i < allVideos.rows.length; i++) {
      if (shouldStop) {
        // Save progress before exiting
        saveProgress(startIndex + i, totalProcessed);
        console.log(`${colors.green}Progress saved. Run the script again to resume.${colors.reset}`);
        break;
      }
      
      const video = allVideos.rows[i];
      let baseline = 1.0;
      
      // Get preloaded history
      const history = historyMap.get(video.id) || [];
      
      if (history.length >= 3) {
        // Calculate Day 30 views for each historical video
        const day30Views = [];
        
        for (const hist of history) {
          let day30Value;
          
          if (hist.day30_snapshot) {
            // Use actual Day 30 snapshot if available
            day30Value = hist.day30_snapshot;
          } else {
            // Use backfill formula with cached envelope data
            const currentViews = hist.current_views;
            const envelopeAtCurrentAge = envelopeMap.get(Math.min(hist.current_age, 3650)) || day30GlobalP50;
            const envelopeAtDay30 = day30GlobalP50;
            
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
      } else if (history.length > 0) {
        // Less than 3 videos, but at least 1
        const day30Views = [];
        
        for (const hist of history) {
          let day30Value;
          
          if (hist.day30_snapshot) {
            day30Value = hist.day30_snapshot;
          } else {
            const currentViews = hist.current_views;
            const envelopeAtCurrentAge = envelopeMap.get(Math.min(hist.current_age, 3650)) || day30GlobalP50;
            const envelopeAtDay30 = day30GlobalP50;
            
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
      
      // Update database in larger batches
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
        const estimatedTotal = startIndex + allVideos.rows.length;
        const percentComplete = ((totalProcessed / estimatedTotal) * 100).toFixed(1);
        
        process.stdout.write(`\r${colors.green}Processed ${totalProcessed.toLocaleString()} / ~${estimatedTotal.toLocaleString()} videos (${percentComplete}%) at ${rate} videos/sec...${colors.reset}`);
        
        // Save progress periodically
        if (totalProcessed % 10000 === 0) {
          saveProgress(startIndex + i, totalProcessed);
        }
      }
    }

    if (!shouldStop) {
      console.log(`\n\n${colors.green}✓ Processing complete!${colors.reset}`);
      
      // Clean up resume file
      if (fs.existsSync(RESUME_FILE)) {
        fs.unlinkSync(RESUME_FILE);
        console.log(`${colors.cyan}Cleaned up resume file${colors.reset}`);
      }

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

      // Refresh materialized view
      console.log(`\n${colors.cyan}Refreshing materialized view...${colors.reset}`);
      await client.query('REFRESH MATERIALIZED VIEW heistable_videos');
      console.log(`${colors.green}✓ Materialized view refreshed${colors.reset}`);

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const finalRate = (totalProcessed / totalTime).toFixed(1);
      
      console.log(`\n${colors.bright}${colors.green}✅ ALL BASELINES FIXED!${colors.reset}`);
      console.log(`\nProcessed ${totalProcessed.toLocaleString()} videos in ${totalTime} seconds (${finalRate} videos/sec)`);
    }

  } catch (error) {
    console.error(`\n${colors.red}Error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    
    // Save progress even on error
    if (totalProcessed > 0) {
      saveProgress(startIndex + totalProcessed, totalProcessed);
      console.log(`${colors.yellow}Progress saved. You can resume from where it stopped.${colors.reset}`);
    }
    
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the fix
fixAllBaselines().catch(console.error);