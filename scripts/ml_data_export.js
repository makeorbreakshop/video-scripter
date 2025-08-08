#!/usr/bin/env node

/**
 * Export ML training data using direct database connection
 * Based on the same approach as direct-db-update.js
 */

import { Client } from 'pg';
import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse connection string from Supabase (same as direct-db-update.js)
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

async function exportMLTrainingData() {
  const DATABASE_URL = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL || process.env.DIRECT_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL environment variable');
    console.log('\n💡 Get your direct connection string from:');
    console.log('   Supabase Dashboard > Settings > Database > Connection String > URI');
    console.log('   Use the POOLER connection (port 6543) for bulk operations');
    return;
  }

  const client = new Client(parseConnectionString(DATABASE_URL));

  try {
    console.log('🔌 Connecting directly to PostgreSQL for ML data export...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // Export ML training data - exactly what we need for envelope training
    console.log('📊 Exporting ML training dataset...');
    
    const query = `
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
        AND vs.days_since_published BETWEEN 0 AND 365  -- Focus on first year
      ORDER BY v.channel_name, v.id, vs.days_since_published
    `;

    console.log('🚀 Executing query (this may take a few minutes for 698K+ records)...');
    const startTime = Date.now();
    
    const result = await client.query(query);
    
    const duration = (Date.now() - startTime) / 1000;
    console.log(`✅ Query completed in ${duration.toFixed(1)}s`);
    console.log(`📈 Retrieved ${result.rows.length.toLocaleString()} training records`);
    
    // Get summary statistics
    const uniqueVideos = new Set(result.rows.map(r => r.video_id)).size;
    const uniqueChannels = new Set(result.rows.map(r => r.channel_name)).size;
    const dateRange = {
      earliest: Math.min(...result.rows.map(r => r.days_since_published)),
      latest: Math.max(...result.rows.map(r => r.days_since_published))
    };
    
    console.log(`\n📊 Dataset Summary:`);
    console.log(`   Records: ${result.rows.length.toLocaleString()}`);
    console.log(`   Videos: ${uniqueVideos.toLocaleString()}`);
    console.log(`   Channels: ${uniqueChannels.toLocaleString()}`);
    console.log(`   Days tracked: ${dateRange.earliest} to ${dateRange.latest}`);
    
    // Save in batches to avoid memory issues
    const batchSize = 25000;
    const totalRecords = result.rows.length;
    const totalBatches = Math.ceil(totalRecords / batchSize);
    
    console.log(`\n💾 Saving ${totalRecords.toLocaleString()} records in ${totalBatches} batches...`);
    
    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      const end = Math.min(start + batchSize, totalRecords);
      const batch = result.rows.slice(start, end);
      
      const batchPath = `data/ml_training_batch_${i + 1}.json`;
      await fs.writeFile(batchPath, JSON.stringify(batch, null, 2));
      console.log(`✅ Saved batch ${i + 1}/${totalBatches}: ${batch.length.toLocaleString()} records to ${batchPath}`);
    }
    
    // Also save a sample for quick testing
    const samplePath = 'data/ml_training_sample.json';
    const sample = result.rows.slice(0, 10000);  // First 10K records
    await fs.writeFile(samplePath, JSON.stringify(sample, null, 2));
    console.log(`✅ Saved sample (${sample.length.toLocaleString()} records) to ${samplePath}`);
    
    // Save metadata
    const metadata = {
      export_date: new Date().toISOString(),
      total_records: result.rows.length,
      unique_videos: uniqueVideos,
      unique_channels: uniqueChannels,
      days_range: dateRange,
      query_duration_seconds: duration
    };
    
    await fs.writeFile('data/ml_dataset_metadata.json', JSON.stringify(metadata, null, 2));
    console.log(`✅ Saved metadata to data/ml_dataset_metadata.json`);
    
    console.log('\n🎉 ML training dataset export complete!');
    console.log('🐍 Ready for Python ML training pipeline');
    
  } catch (error) {
    console.error('❌ Export failed:', error.message);
    if (error.message.includes('timeout')) {
      console.log('\n💡 Query timed out. Try:');
      console.log('   1. Use the POOLER connection (port 6543)');
      console.log('   2. Add LIMIT clause for testing');
      console.log('   3. Export in batches by channel or date range');
    }
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  exportMLTrainingData();
}