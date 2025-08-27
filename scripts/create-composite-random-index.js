#!/usr/bin/env node

import { Client } from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL not found in environment variables');
  process.exit(1);
}

async function createCompositeIndex() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    console.log('\n📊 Creating composite index for fast filtering + random sort...');
    console.log('This will take a minute on 660K rows...\n');
    
    // Create a composite index that covers all filter columns PLUS random_sort
    const startTime = Date.now();
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_idea_radar_random
      ON videos (
        is_short,
        is_institutional,
        temporal_performance_score,
        view_count,
        published_at DESC,
        random_sort
      )
      WHERE is_short = false AND is_institutional = false;
    `);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Index created in ${duration} seconds`);
    
    // Test the performance again
    console.log('\n🧪 Testing query performance with new index...');
    
    const tests = [
      { days: 365, score: 1, views: 100, desc: '1 year, 1.5x, 100+ views' },
      { days: 730, score: 1, views: 100, desc: '2 years, 1.5x, 100+ views' },
      { days: 90, score: 3, views: 10000, desc: 'Quarter, 3x, 10K+ views' }
    ];
    
    for (const test of tests) {
      const startTime = Date.now();
      const result = await client.query(`
        SELECT COUNT(*) as count
        FROM (
          SELECT v.id
          FROM videos v
          WHERE v.temporal_performance_score >= $1
            AND v.temporal_performance_score <= 100
            AND v.view_count >= $2
            AND v.published_at >= NOW() - ($3 || ' days')::interval
            AND v.is_short = false
            AND v.is_institutional = false
          ORDER BY v.random_sort
          LIMIT 1000
        ) t;
      `, [test.score, test.views, test.days]);
      
      const duration = Date.now() - startTime;
      const status = duration < 500 ? '✅' : duration < 1000 ? '⚠️' : '❌';
      console.log(`${status} ${test.desc}: ${result.rows[0].count} videos in ${duration}ms`);
    }
    
    // Analyze the query plan
    console.log('\n📈 Checking query plan with new index...');
    const explainResult = await client.query(`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT v.id
      FROM videos v
      WHERE v.temporal_performance_score >= 1
        AND v.temporal_performance_score <= 100
        AND v.view_count >= 100
        AND v.published_at >= NOW() - INTERVAL '365 days'
        AND v.is_short = false
        AND v.is_institutional = false
      ORDER BY v.random_sort
      LIMIT 1000;
    `);
    
    const plan = explainResult.rows[0]['QUERY PLAN'][0];
    console.log('Execution Time:', plan['Execution Time'], 'ms');
    console.log('Index Used:', plan.Plan['Index Name'] || 'Not using index directly');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed');
  }
}

// Run the script
createCompositeIndex();