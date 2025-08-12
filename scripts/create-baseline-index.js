#!/usr/bin/env node

/**
 * Create optimized index for baseline calculations
 * Bypasses Supabase timeouts by using direct PostgreSQL connection
 */

import { Client } from 'pg';
import { config } from 'dotenv';

config();

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

async function createIndex() {
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL or DIRECT_URL environment variable');
    return;
  }

  const client = new Client(parseConnectionString(DATABASE_URL));

  try {
    console.log('🔌 Connecting directly to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // Set a long timeout for index creation (in milliseconds)
    await client.query("SET statement_timeout = '1800000'"); // 30 minutes in ms
    console.log('⏱️  Set statement timeout to 30 minutes\n');

    console.log('🔨 Creating optimized baseline index...');
    console.log('   This may take several minutes for large tables...\n');
    
    const startTime = Date.now();
    
    try {
      await client.query(`
        CREATE INDEX idx_videos_baseline_optimized 
        ON videos (channel_id, published_at DESC) 
        WHERE is_short = false 
          AND published_at IS NOT NULL 
          AND view_count > 0
      `);
      
      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`✅ Index created successfully in ${Math.round(elapsed)} seconds!\n`);
      
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('ℹ️  Index already exists\n');
      } else {
        throw error;
      }
    }
    
    // Analyze the table to update statistics
    console.log('📊 Analyzing table to update statistics...');
    await client.query('ANALYZE videos');
    console.log('✅ Table analyzed!\n');
    
    // Test the performance improvement
    console.log('🧪 Testing query performance with new index...');
    
    const testResult = await client.query(`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT v.id, v.view_count
      FROM videos v
      WHERE v.channel_id = (SELECT channel_id FROM videos WHERE channel_id IS NOT NULL LIMIT 1)
      AND v.published_at < NOW()
      AND v.published_at IS NOT NULL
      AND v.view_count > 0
      AND v.is_short = false
      ORDER BY v.published_at DESC
      LIMIT 10
    `);
    
    const plan = testResult.rows[0]['QUERY PLAN'][0];
    const planningTime = plan['Planning Time'];
    const executionTime = plan['Execution Time'];
    
    console.log(`📈 Performance Results:`);
    console.log(`   Planning Time: ${planningTime.toFixed(2)} ms`);
    console.log(`   Execution Time: ${executionTime.toFixed(2)} ms`);
    
    if (planningTime < 10) {
      console.log(`\n🎉 EXCELLENT! Planning time is now under 10ms!`);
      console.log(`   This should give you 10-50x speedup for baseline calculations`);
    } else {
      console.log(`\n⚠️  Planning time is still high. You may need to:`);
      console.log(`   1. Run VACUUM ANALYZE videos;`);
      console.log(`   2. Increase work_mem`);
      console.log(`   3. Check for competing indexes`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

// Run the index creation
createIndex().catch(console.error);