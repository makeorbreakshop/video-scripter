#!/usr/bin/env node
import dotenv from 'dotenv';
import pg from 'pg';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use the pooler connection for better handling of bulk operations
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function exportOutliers() {
  console.log('🎯 Exporting May-June 2025 outliers (3x+ performance)...\n');
  
  try {
    // Query all outliers from May-June 2025
    const query = `
      SELECT 
        v.id as video_id,
        v.title,
        v.channel_name,
        v.channel_id,
        v.topic_niche,
        v.format_type,
        v.view_count,
        ROUND(v.temporal_performance_score::numeric, 2) as performance_score,
        ROUND(v.channel_baseline_at_publish::numeric, 0) as channel_baseline,
        v.published_at::date as published_date,
        v.thumbnail_url,
        v.llm_summary,
        CASE 
          WHEN v.temporal_performance_score >= 50 THEN '50-100x'
          WHEN v.temporal_performance_score >= 20 THEN '20-50x'
          WHEN v.temporal_performance_score >= 10 THEN '10-20x'
          WHEN v.temporal_performance_score >= 5 THEN '5-10x'
          ELSE '3-5x'
        END as performance_tier
      FROM videos v
      WHERE 
        v.temporal_performance_score >= 3.0
        AND v.temporal_performance_score <= 100
        AND v.published_at >= '2025-05-01'
        AND v.published_at < '2025-07-01'
        AND v.view_count > 1000
        AND v.topic_niche IS NOT NULL
      ORDER BY v.temporal_performance_score DESC
    `;

    console.log('Querying database...');
    const result = await pool.query(query);
    const videos = result.rows;
    
    console.log(`\n✅ Found ${videos.length} outlier videos\n`);

    // Group by performance tier for analysis
    const tiers = {};
    videos.forEach(video => {
      if (!tiers[video.performance_tier]) {
        tiers[video.performance_tier] = [];
      }
      tiers[video.performance_tier].push(video);
    });

    // Display summary statistics
    console.log('📊 Performance Tier Distribution:');
    console.log('================================');
    Object.keys(tiers).forEach(tier => {
      console.log(`${tier.padEnd(10)} : ${tiers[tier].length} videos`);
    });

    // Group by niche
    const niches = {};
    videos.forEach(video => {
      if (!niches[video.topic_niche]) {
        niches[video.topic_niche] = [];
      }
      niches[video.topic_niche].push(video);
    });

    // Sort niches by count
    const sortedNiches = Object.entries(niches)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 15);

    console.log('\n📊 Top 15 Niches:');
    console.log('==================');
    sortedNiches.forEach(([niche, vids]) => {
      const avgScore = (vids.reduce((sum, v) => sum + parseFloat(v.performance_score), 0) / vids.length).toFixed(1);
      console.log(`${niche.padEnd(25)} : ${vids.length} videos (avg ${avgScore}x)`);
    });

    // Export to JSON file
    const exportDir = path.join(path.dirname(__dirname), 'exports');
    await fs.mkdir(exportDir, { recursive: true });
    
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `outliers-may-june-2025-${timestamp}.json`;
    const filepath = path.join(exportDir, filename);
    
    const exportData = {
      metadata: {
        total_videos: videos.length,
        date_range: 'May-June 2025',
        performance_threshold: '3x+',
        export_date: new Date().toISOString(),
        tiers: Object.fromEntries(
          Object.entries(tiers).map(([tier, vids]) => [tier, vids.length])
        )
      },
      videos: videos
    };

    await fs.writeFile(filepath, JSON.stringify(exportData, null, 2));
    console.log(`\n✅ Exported to: ${filepath}`);

    // Also create a CSV for easier analysis
    const csvFilename = `outliers-may-june-2025-${timestamp}.csv`;
    const csvFilepath = path.join(exportDir, csvFilename);
    
    const csvHeader = 'video_id,title,channel_name,topic_niche,format_type,view_count,performance_score,performance_tier,published_date,summary\n';
    const csvRows = videos.map(v => {
      const escapedTitle = `"${v.title.replace(/"/g, '""')}"`;
      const escapedSummary = v.llm_summary ? `"${v.llm_summary.replace(/"/g, '""').replace(/\n/g, ' ')}"` : '""';
      return `${v.video_id},${escapedTitle},${v.channel_name},${v.topic_niche},${v.format_type},${v.view_count},${v.performance_score},${v.performance_tier},${v.published_date},${escapedSummary}`;
    }).join('\n');
    
    await fs.writeFile(csvFilepath, csvHeader + csvRows);
    console.log(`✅ CSV exported to: ${csvFilepath}`);

    // Create a high-performers subset (10x+) for focused analysis
    const highPerformers = videos.filter(v => parseFloat(v.performance_score) >= 10);
    const hpFilename = `outliers-10x-plus-may-june-2025-${timestamp}.json`;
    const hpFilepath = path.join(exportDir, hpFilename);
    
    await fs.writeFile(hpFilepath, JSON.stringify({
      metadata: {
        total_videos: highPerformers.length,
        performance_threshold: '10x+',
        export_date: new Date().toISOString()
      },
      videos: highPerformers
    }, null, 2));
    
    console.log(`✅ High performers (10x+) exported to: ${hpFilename}`);
    console.log(`   Total: ${highPerformers.length} videos`);

  } catch (error) {
    console.error('❌ Error exporting outliers:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the export
exportOutliers();