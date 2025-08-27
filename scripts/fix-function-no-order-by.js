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

async function removeOrderByForSpeed() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    console.log('🗑️ Dropping existing function...');
    await client.query(`
      DROP FUNCTION IF EXISTS get_random_video_ids(int, int, int, text, int, text);
    `);
    
    console.log('✅ Old function dropped');
    
    console.log('\n🚀 Creating FAST version WITHOUT ORDER BY...');
    
    // Create function that returns videos in natural heap order (no sorting)
    await client.query(`
      CREATE OR REPLACE FUNCTION get_random_video_ids(
        p_outlier_score int DEFAULT 2,
        p_min_views int DEFAULT 1000,
        p_days_ago int DEFAULT 90,
        p_domain text DEFAULT NULL,
        p_sample_size int DEFAULT 1000,  -- Changed default to 1000
        p_category text DEFAULT NULL
      )
      RETURNS TABLE(video_id text)
      LANGUAGE sql AS
      $$
        -- NO ORDER BY = Natural heap order = FAST!
        SELECT v.id
        FROM videos v
        WHERE v.temporal_performance_score >= p_outlier_score
          AND v.temporal_performance_score <= 100
          AND v.view_count >= p_min_views
          AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
          AND v.is_short = false
          AND v.is_institutional = false
          AND (p_domain IS NULL OR v.topic_domain = p_domain)
          AND (p_category IS NULL OR p_category = 'all' OR v.metadata->>'category_id' = p_category)
        -- NO ORDER BY HERE! Returns in natural heap order
        LIMIT p_sample_size * 2;  -- Get 2000 for variety (1000 * 2)
      $$;
    `);
    
    console.log('✅ Created FAST function with:');
    console.log('   - NO ORDER BY (natural heap order)');
    console.log('   - Default sample size: 1000');
    console.log('   - Returns 2000 IDs for JavaScript shuffling');
    console.log('   - No expensive sorting operations');

    // Test the problematic case
    console.log('\n🧪 Testing YOUR TIMEOUT CASE (180 days, 1.5x)...');
    
    const testCases = [
      { days: 7, score: 3, views: 10000, label: 'Week, 3x, 10K+ views' },
      { days: 30, score: 3, views: 10000, label: 'Month, 3x, 10K+ views' },
      { days: 180, score: 1, views: 10000, label: 'Half year, 1.5x, 10K+ views (YOUR PROBLEM CASE)' },
      { days: 365, score: 1, views: 100, label: '1 year, 1.5x, 100+ views' },
      { days: 730, score: 1, views: 100, label: '2 years, 1.5x, 100+ views (WORST CASE)' }
    ];
    
    for (const test of testCases) {
      const startTime = Date.now();
      const result = await client.query(`
        SELECT COUNT(*) as count
        FROM get_random_video_ids($1, $2, $3, NULL, 1000, NULL);
      `, [test.score, test.views, test.days]);
      
      const duration = Date.now() - startTime;
      const status = duration < 500 ? '✅' : duration < 1000 ? '⚠️' : '❌';
      console.log(`${status} ${test.label}: ${result.rows[0].count} videos in ${duration}ms`);
    }

    // Explain why this is faster
    console.log('\n📊 Why this is faster:');
    console.log('1. No ORDER BY = No sorting of 49,000+ rows');
    console.log('2. PostgreSQL just returns first 2000 matches it finds');
    console.log('3. Natural heap order provides variety over time');
    console.log('4. JavaScript shuffle is instant for 1000 IDs');
    console.log('5. Users get different results as table naturally changes');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed');
    console.log('\n✨ Now your youtube-demo-v2 page should load FAST!');
    console.log('📝 Remember: The API will shuffle these IDs in JavaScript for variety');
  }
}

// Run the script
removeOrderByForSpeed();