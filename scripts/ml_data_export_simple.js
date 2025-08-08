#!/usr/bin/env node

/**
 * Simple ML data export with basic LIMIT/OFFSET pagination
 * Reliable approach - no cursor complexity
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

async function simpleMLExport() {
  const DATABASE_URL = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL || process.env.DIRECT_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL environment variable');
    return;
  }

  const client = new Client(parseConnectionString(DATABASE_URL));

  try {
    console.log('🔌 Connecting for simple ML data export...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // Get total count first
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

    // Use larger batches to minimize OFFSET slowdown
    const batchSize = 50000; // Larger batches = fewer round trips
    const totalBatches = Math.ceil(totalRecords / batchSize);
    
    // Base query
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

    console.log('🚀 Starting simple export with 50K batches...\n');

    let processedRecords = 0;

    // Export in batches
    for (let batchNum = 1; batchNum <= totalBatches; batchNum++) {
      const offset = (batchNum - 1) * batchSize;
      
      console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${offset.toLocaleString()}-${Math.min(offset + batchSize, totalRecords).toLocaleString()})...`);
      
      const batchQuery = `${baseQuery} LIMIT ${batchSize} OFFSET ${offset}`;
      const startTime = Date.now();
      
      const result = await client.query(batchQuery);
      const duration = (Date.now() - startTime) / 1000;
      
      if (result.rows.length === 0) {
        console.log('✅ No more records found, export complete');
        break;
      }

      // Save batch immediately
      const batchPath = `data/ml_training_batch_${batchNum}.json`;
      await fs.writeFile(batchPath, JSON.stringify(result.rows, null, 2));
      
      processedRecords += result.rows.length;
      
      console.log(`✅ Batch ${batchNum}: ${result.rows.length.toLocaleString()} records in ${duration.toFixed(1)}s → ${batchPath}`);
      console.log(`   Progress: ${processedRecords.toLocaleString()}/${totalRecords.toLocaleString()} (${((processedRecords/totalRecords)*100).toFixed(1)}%)`);
      
      // Show time estimates for later batches
      if (batchNum >= 3) {
        const avgTime = duration;
        const remainingBatches = totalBatches - batchNum;
        const estimatedMinutes = (remainingBatches * avgTime) / 60;
        console.log(`   ⏱️  Estimated time remaining: ~${estimatedMinutes.toFixed(1)} minutes`);
      }
      
      console.log('');
      
      // Break if we got fewer records than expected (end of data)
      if (result.rows.length < batchSize) {
        console.log('✅ Reached end of data');
        break;
      }
    }

    // Save metadata
    const metadata = {
      export_date: new Date().toISOString(),
      total_records: processedRecords,
      expected_records: totalRecords,
      batch_size: batchSize,
      export_method: 'simple_limit_offset'
    };
    
    await fs.writeFile('data/ml_dataset_simple_metadata.json', JSON.stringify(metadata, null, 2));
    
    console.log('='.repeat(60));
    console.log('🎉 Simple export complete!');
    console.log(`📊 Exported ${processedRecords.toLocaleString()} records`);
    console.log(`📈 Expected ${totalRecords.toLocaleString()} records`);
    console.log(`📁 Saved as ${Math.ceil(processedRecords/batchSize)} batch files`);
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
  simpleMLExport();
}