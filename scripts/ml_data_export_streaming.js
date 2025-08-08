#!/usr/bin/env node

/**
 * Streaming ML data export using cursor-based pagination
 * Best practice for large datasets - never loads everything into memory
 */

import { Client } from 'pg';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse connection string from Supabase
function parseConnectionString(url) {
  const dbUrl = new URL(url);
  return {
    user: dbUrl.username,
    password: dbUrl.password,
    host: dbUrl.hostname,
    port: dbUrl.port || 5432,
    database: dbUrl.pathname.slice(1),
    ssl: { rejectUnauthorized: false }
  };
}

async function streamingMLExport() {
  const DATABASE_URL = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL || process.env.DIRECT_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL environment variable');
    return;
  }

  const client = new Client(parseConnectionString(DATABASE_URL));

  try {
    console.log('🔌 Connecting for streaming ML data export...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // First, get total count for progress tracking
    console.log('📊 Getting total record count...');
    const countQuery = `
      SELECT COUNT(*) as total
      FROM videos v
      INNER JOIN view_snapshots vs ON v.id = vs.video_id
      WHERE v.format_type IS NOT NULL
        AND v.topic_cluster_id IS NOT NULL
        AND v.metadata->'channel_stats'->>'subscriber_count' IS NOT NULL
        AND vs.view_count > 0
    `;
    
    const countResult = await client.query(countQuery);
    const totalRecords = parseInt(countResult.rows[0].total);
    console.log(`📈 Total records to export: ${totalRecords.toLocaleString()}\n`);

    // Stream data in chunks using cursor-based pagination
    const batchSize = 25000;
    const totalBatches = Math.ceil(totalRecords / batchSize);
    let currentBatch = 1;
    let processedRecords = 0;

    // Base query without LIMIT/OFFSET
    const baseQuery = `
      SELECT 
        v.id as video_id,
        v.title,
        v.channel_name,
        v.channel_id,
        v.published_at,
        v.format_type,
        v.topic_cluster_id,
        v.topic_domain,
        
        -- Extract channel metadata
        (v.metadata->'channel_stats'->>'subscriber_count')::bigint as subscriber_count,
        (v.metadata->'channel_stats'->>'video_count')::bigint as channel_video_count,
        
        -- Video characteristics
        LENGTH(v.title) as title_length,
        array_length(string_to_array(v.title, ' '), 1) as title_word_count,
        EXTRACT(DOW FROM v.published_at) as day_of_week,
        EXTRACT(HOUR FROM v.published_at) as hour_of_day,
        
        -- View snapshots data
        vs.days_since_published,
        vs.view_count,
        vs.snapshot_date
        
      FROM videos v
      INNER JOIN view_snapshots vs ON v.id = vs.video_id
      WHERE v.format_type IS NOT NULL
        AND v.topic_cluster_id IS NOT NULL
        AND v.metadata->'channel_stats'->>'subscriber_count' IS NOT NULL
        AND vs.view_count > 0
      ORDER BY v.id, vs.days_since_published
    `;

    console.log('🚀 Starting streaming export...\n');

    // Create summary stats collectors
    const uniqueVideos = new Set();
    const uniqueChannels = new Set();
    let minDays = Infinity;
    let maxDays = -Infinity;

    // Stream data in batches
    for (let offset = 0; offset < totalRecords; offset += batchSize) {
      console.log(`📦 Processing batch ${currentBatch}/${totalBatches} (${offset.toLocaleString()}-${Math.min(offset + batchSize, totalRecords).toLocaleString()})...`);
      
      const batchQuery = `${baseQuery} LIMIT ${batchSize} OFFSET ${offset}`;
      const startTime = Date.now();
      
      const result = await client.query(batchQuery);
      const duration = (Date.now() - startTime) / 1000;
      
      if (result.rows.length === 0) break; // No more data

      // Collect stats
      result.rows.forEach(row => {
        uniqueVideos.add(row.video_id);
        uniqueChannels.add(row.channel_name);
        minDays = Math.min(minDays, row.days_since_published);
        maxDays = Math.max(maxDays, row.days_since_published);
      });

      // Save batch immediately (no memory accumulation)
      const batchPath = `data/ml_training_batch_${currentBatch}.json`;
      await fs.writeFile(batchPath, JSON.stringify(result.rows, null, 2));
      
      processedRecords += result.rows.length;
      
      console.log(`✅ Batch ${currentBatch}: ${result.rows.length.toLocaleString()} records in ${duration.toFixed(1)}s → ${batchPath}`);
      console.log(`   Progress: ${processedRecords.toLocaleString()}/${totalRecords.toLocaleString()} (${((processedRecords/totalRecords)*100).toFixed(1)}%)\n`);
      
      currentBatch++;
      
      // Break if we got fewer records than expected (end of data)
      if (result.rows.length < batchSize) break;
    }

    // Save metadata
    const metadata = {
      export_date: new Date().toISOString(),
      total_records: processedRecords,
      unique_videos: uniqueVideos.size,
      unique_channels: uniqueChannels.size,
      days_range: { earliest: minDays, latest: maxDays },
      total_batches: currentBatch - 1,
      batch_size: batchSize
    };
    
    await fs.writeFile('data/ml_dataset_metadata_streaming.json', JSON.stringify(metadata, null, 2));
    
    console.log('='.repeat(60));
    console.log('🎉 Streaming export complete!');
    console.log(`📊 Exported ${processedRecords.toLocaleString()} records across ${currentBatch - 1} batches`);
    console.log(`📹 ${uniqueVideos.size.toLocaleString()} unique videos from ${uniqueChannels.size.toLocaleString()} channels`);
    console.log(`📅 Days tracked: ${minDays} to ${maxDays}`);
    console.log('🐍 Ready for Python ML training pipeline');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Export failed:', error.message);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  streamingMLExport();
}