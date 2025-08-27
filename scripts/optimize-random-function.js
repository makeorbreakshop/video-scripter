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

async function optimizeFunction() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    // Disable timeouts for this session
    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    console.log('🔄 Updating get_random_video_ids function with optimized version...');
    
    // Use random starting point to leverage the index better
    await client.query(`
      CREATE OR REPLACE FUNCTION get_random_video_ids(
        p_outlier_score int DEFAULT 2,
        p_min_views int DEFAULT 1000,
        p_days_ago int DEFAULT 90,
        p_domain text DEFAULT NULL,
        p_sample_size int DEFAULT 500
      )
      RETURNS TABLE(video_id text)
      LANGUAGE sql AS
      $$
        SELECT id
        FROM videos
        WHERE temporal_performance_score >= p_outlier_score
          AND temporal_performance_score <= 100
          AND view_count >= p_min_views
          AND published_at >= NOW() - (p_days_ago || ' days')::interval
          AND is_short = false
          AND is_institutional = false
          AND (p_domain IS NULL OR topic_domain = p_domain)
          AND random_sort >= random()  -- Start from random point in index
        ORDER BY random_sort
        LIMIT p_sample_size;
      $$;
    `);
    
    console.log('✅ Function updated successfully');

    // Test the function
    console.log('\n🧪 Testing function with broadest filters...');
    const startTime = Date.now();
    
    const { rows } = await client.query(`
      SELECT * FROM get_random_video_ids(
        p_outlier_score => 1,
        p_min_views => 100,
        p_days_ago => 730,
        p_sample_size => 50
      );
    `);
    
    const duration = Date.now() - startTime;
    
    console.log(`✅ Function returned ${rows.length} results in ${(duration / 1000).toFixed(2)} seconds`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed');
  }
}

// Run the script
optimizeFunction();