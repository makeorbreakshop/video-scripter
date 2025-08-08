#!/usr/bin/env node

/**
 * Resume ML data export using cursor-based pagination (much faster)
 * Continues from where the previous export left off
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

async function findLastProcessedRecord() {
  // Find the highest batch number
  const dataDir = 'data';
  const files = await fs.readdir(dataDir).catch(() => []);
  const batchFiles = files.filter(f => f.startsWith('ml_training_batch_') && f.endsWith('.json'));
  
  if (batchFiles.length === 0) {
    console.log('🔄 No existing batches found, starting from beginning');
    return { lastVideoId: null, lastDays: null, startBatch: 1, processedRecords: 0 };
  }

  // Get highest batch number
  const batchNumbers = batchFiles.map(f => parseInt(f.match(/batch_(\d+)/)[1]));
  const highestBatch = Math.max(...batchNumbers);
  
  console.log(`📋 Found existing batches 1-${highestBatch}`);
  
  // Read the last batch to find the last record
  const lastBatchFile = `data/ml_training_batch_${highestBatch}.json`;
  const lastBatchData = JSON.parse(await fs.readFile(lastBatchFile, 'utf-8'));
  const lastRecord = lastBatchData[lastBatchData.length - 1];
  
  // Calculate processed records
  const processedRecords = (highestBatch - 1) * 25000 + lastBatchData.length;
  
  console.log(`📊 Last processed: video_id=${lastRecord.video_id}, days=${lastRecord.days_since_published}`);
  console.log(`📈 Records processed: ${processedRecords.toLocaleString()}`);
  
  return { 
    lastVideoId: lastRecord.video_id, 
    lastDays: lastRecord.days_since_published,
    startBatch: highestBatch + 1,
    processedRecords 
  };
}

async function resumeMLExport() {
  const DATABASE_URL = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL || process.env.DIRECT_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL environment variable');
    return;
  }

  const client = new Client(parseConnectionString(DATABASE_URL));

  try {
    console.log('🔌 Connecting for resume ML data export...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // Find where we left off
    const { lastVideoId, lastDays, startBatch, processedRecords } = await findLastProcessedRecord();

    // Get total count for progress tracking
    console.log('📊 Getting remaining record count...');
    let countQuery, whereClause;
    
    if (lastVideoId) {
      // Use cursor-based pagination (much faster than OFFSET)
      whereClause = `
        WHERE v.format_type IS NOT NULL
          AND v.topic_cluster_id IS NOT NULL
          AND v.metadata->'channel_stats'->>'subscriber_count' IS NOT NULL
          AND vs.view_count > 0
          AND (v.id > '${lastVideoId}' OR (v.id = '${lastVideoId}' AND vs.days_since_published > ${lastDays}))
      `;
    } else {
      whereClause = `
        WHERE v.format_type IS NOT NULL
          AND v.topic_cluster_id IS NOT NULL
          AND v.metadata->'channel_stats'->>'subscriber_count' IS NOT NULL
          AND vs.view_count > 0
      `;
    }
    
    countQuery = `
      SELECT COUNT(*) as total
      FROM videos v
      INNER JOIN view_snapshots vs ON v.id = vs.video_id
      ${whereClause}
    `;
    
    const countResult = await client.query(countQuery);
    const remainingRecords = parseInt(countResult.rows[0].total);
    const totalRecords = processedRecords + remainingRecords;
    
    console.log(`📈 Remaining records: ${remainingRecords.toLocaleString()}`);
    console.log(`📊 Total records: ${totalRecords.toLocaleString()}`);
    console.log(`✅ Progress: ${processedRecords.toLocaleString()}/${totalRecords.toLocaleString()} (${((processedRecords/totalRecords)*100).toFixed(1)}%)\n`);

    if (remainingRecords === 0) {
      console.log('🎉 Export already complete!');
      return;
    }

    // Base query using cursor pagination
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
      ${whereClause}
      ORDER BY v.id, vs.days_since_published
    `;

    console.log('🚀 Resuming streaming export...\n');

    // Stream remaining data in batches
    const batchSize = 25000;
    let currentBatch = startBatch;
    let currentProcessed = processedRecords;
    let lastId = lastVideoId;
    let lastDaysVal = lastDays;

    // Use cursor-based pagination
    while (true) {
      console.log(`📦 Processing batch ${currentBatch} (cursor-based)...`);
      
      let batchQuery;
      if (lastId) {
        batchQuery = `${baseQuery.replace(whereClause, whereClause)} LIMIT ${batchSize}`;
      } else {
        batchQuery = `${baseQuery} LIMIT ${batchSize}`;
      }
      
      const startTime = Date.now();
      const result = await client.query(batchQuery);
      const duration = (Date.now() - startTime) / 1000;
      
      if (result.rows.length === 0) break; // No more data

      // Save batch immediately
      const batchPath = `data/ml_training_batch_${currentBatch}.json`;
      await fs.writeFile(batchPath, JSON.stringify(result.rows, null, 2));
      
      currentProcessed += result.rows.length;
      
      console.log(`✅ Batch ${currentBatch}: ${result.rows.length.toLocaleString()} records in ${duration.toFixed(1)}s → ${batchPath}`);
      console.log(`   Progress: ${currentProcessed.toLocaleString()}/${totalRecords.toLocaleString()} (${((currentProcessed/totalRecords)*100).toFixed(1)}%)\n`);
      
      // Update cursor for next batch
      const lastRecord = result.rows[result.rows.length - 1];
      lastId = lastRecord.video_id;
      lastDaysVal = lastRecord.days_since_published;
      
      // Update WHERE clause for next iteration
      const newWhereClause = `
        WHERE v.format_type IS NOT NULL
          AND v.topic_cluster_id IS NOT NULL
          AND v.metadata->'channel_stats'->>'subscriber_count' IS NOT NULL
          AND vs.view_count > 0
          AND (v.id > '${lastId}' OR (v.id = '${lastId}' AND vs.days_since_published > ${lastDaysVal}))
      `;
      
      // Update base query for next iteration
      const newBaseQuery = baseQuery.replace(whereClause, newWhereClause);
      
      currentBatch++;
      
      // Break if we got fewer records than expected (end of data)
      if (result.rows.length < batchSize) break;
    }

    console.log('='.repeat(60));
    console.log('🎉 Resume export complete!');
    console.log(`📊 Total batches: ${currentBatch - 1}`);
    console.log(`📈 Total records: ${currentProcessed.toLocaleString()}`);
    console.log('🐍 Ready for Python ML training pipeline');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ Resume export failed:', error.message);
    console.error(error.stack);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resumeMLExport();
}