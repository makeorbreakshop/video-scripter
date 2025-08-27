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

async function implementTablesample() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    // Disable timeouts for this session
    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    console.log('🔄 Implementing TABLESAMPLE version of function...');
    
    // Use TABLESAMPLE for fast random selection
    // Increase sample percentage to ensure we get enough matching rows
    await client.query(`
      CREATE OR REPLACE FUNCTION get_random_video_ids(
        p_outlier_score int DEFAULT 2,
        p_min_views int DEFAULT 1000,
        p_days_ago int DEFAULT 90,
        p_domain text DEFAULT NULL,
        p_sample_size int DEFAULT 500
      )
      RETURNS TABLE(video_id text)
      LANGUAGE plpgsql AS
      $$
      DECLARE
        sample_percent float;
        result_count int := 0;
        attempts int := 0;
      BEGIN
        -- Calculate initial sample percentage
        -- Use higher percentage to ensure we get enough results
        sample_percent := GREATEST(1.0, (p_sample_size::float / 1000.0) * 10.0);
        
        -- Try up to 3 times with increasing sample size
        WHILE result_count < p_sample_size AND attempts < 3 LOOP
          attempts := attempts + 1;
          
          -- Clear previous results
          DELETE FROM temp_results WHERE true;
          
          -- Insert results from TABLESAMPLE
          INSERT INTO temp_results
          SELECT id
          FROM videos TABLESAMPLE BERNOULLI (sample_percent * attempts)
          WHERE temporal_performance_score >= p_outlier_score
            AND temporal_performance_score <= 100
            AND view_count >= p_min_views
            AND published_at >= NOW() - (p_days_ago || ' days')::interval
            AND is_short = false
            AND is_institutional = false
            AND (p_domain IS NULL OR topic_domain = p_domain)
          LIMIT p_sample_size;
          
          GET DIAGNOSTICS result_count = ROW_COUNT;
        END LOOP;
        
        -- Return results
        RETURN QUERY
        SELECT video_id FROM temp_results
        LIMIT p_sample_size;
      END;
      $$;
    `);
    
    console.log('❌ That approach won\'t work without a temp table. Let\'s use a simpler approach...');
    
    // Simpler TABLESAMPLE approach
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
        -- Use TABLESAMPLE with a fixed percentage that should give us enough rows
        -- 10% sample of 660K rows = 66K rows, which should be enough after filtering
        SELECT id
        FROM videos TABLESAMPLE BERNOULLI (10)
        WHERE temporal_performance_score >= p_outlier_score
          AND temporal_performance_score <= 100
          AND view_count >= p_min_views
          AND published_at >= NOW() - (p_days_ago || ' days')::interval
          AND is_short = false
          AND is_institutional = false
          AND (p_domain IS NULL OR topic_domain = p_domain)
        ORDER BY random()  -- Randomize the sampled results
        LIMIT p_sample_size;
      $$;
    `);
    
    console.log('✅ Function updated with TABLESAMPLE approach');

    // Test the function
    console.log('\n🧪 Testing function with different filter combinations...');
    
    // Test 1: Narrow filters
    console.log('\nTest 1: Week, 3x performance, 100K+ views');
    let startTime = Date.now();
    let result = await client.query(`
      SELECT COUNT(*) FROM get_random_video_ids(
        p_outlier_score => 3,
        p_min_views => 100000,
        p_days_ago => 7,
        p_sample_size => 20
      );
    `);
    let duration = Date.now() - startTime;
    console.log(`  ✅ Returned ${result.rows[0].count} results in ${(duration / 1000).toFixed(2)}s`);
    
    // Test 2: Medium filters
    console.log('\nTest 2: Month, 3x performance, 10K+ views');
    startTime = Date.now();
    result = await client.query(`
      SELECT COUNT(*) FROM get_random_video_ids(
        p_outlier_score => 3,
        p_min_views => 10000,
        p_days_ago => 30,
        p_sample_size => 50
      );
    `);
    duration = Date.now() - startTime;
    console.log(`  ✅ Returned ${result.rows[0].count} results in ${(duration / 1000).toFixed(2)}s`);
    
    // Test 3: Broad filters
    console.log('\nTest 3: 2 years, 1.5x performance, 100+ views');
    startTime = Date.now();
    result = await client.query(`
      SELECT COUNT(*) FROM get_random_video_ids(
        p_outlier_score => 1,
        p_min_views => 100,
        p_days_ago => 730,
        p_sample_size => 50
      );
    `);
    duration = Date.now() - startTime;
    console.log(`  ✅ Returned ${result.rows[0].count} results in ${(duration / 1000).toFixed(2)}s`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed');
  }
}

// Run the script
implementTablesample();