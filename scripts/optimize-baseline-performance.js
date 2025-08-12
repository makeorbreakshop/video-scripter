#!/usr/bin/env node

/**
 * Optimize baseline calculation performance without deleting indexes
 * Updates statistics and tests query planning
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

async function optimizePerformance() {
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

    // Set a long timeout
    await client.query("SET statement_timeout = '600000'"); // 10 minutes
    
    console.log('🧹 Running VACUUM ANALYZE on videos table...');
    console.log('   This will clean up dead rows and update statistics...\n');
    
    const vacuumStart = Date.now();
    await client.query('VACUUM ANALYZE videos');
    const vacuumTime = (Date.now() - vacuumStart) / 1000;
    
    console.log(`✅ VACUUM ANALYZE completed in ${Math.round(vacuumTime)} seconds\n`);
    
    // Reset query plan cache
    console.log('🔄 Resetting query plan cache...');
    await client.query('DISCARD PLANS');
    console.log('✅ Plan cache reset\n');
    
    // Test performance with hint to use our index
    console.log('🧪 Testing query performance after optimization...\n');
    
    // Get a real channel_id to test with
    const channelResult = await client.query(`
      SELECT channel_id 
      FROM videos 
      WHERE channel_id IS NOT NULL 
        AND is_short = false
      GROUP BY channel_id 
      HAVING COUNT(*) > 10
      LIMIT 1
    `);
    
    const testChannelId = channelResult.rows[0]?.channel_id;
    
    if (testChannelId) {
      // Test the exact query pattern used in calculate_video_channel_baseline
      const testResult = await client.query(`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
        SELECT v.id, v.view_count,
               GREATEST(1, EXTRACT(DAY FROM NOW() - v.published_at)::INTEGER) as current_age
        FROM videos v
        WHERE v.channel_id = $1
        AND v.published_at < NOW()
        AND v.published_at IS NOT NULL
        AND v.view_count > 0
        AND v.is_short = false
        ORDER BY v.published_at DESC
        LIMIT 10
      `, [testChannelId]);
      
      const plan = testResult.rows[0]['QUERY PLAN'][0];
      const planningTime = plan['Planning Time'];
      const executionTime = plan['Execution Time'];
      const indexUsed = JSON.stringify(plan).includes('idx_videos_baseline_optimized');
      
      console.log(`📈 Performance Results for channel: ${testChannelId}`);
      console.log(`   Planning Time: ${planningTime.toFixed(2)} ms`);
      console.log(`   Execution Time: ${executionTime.toFixed(2)} ms`);
      console.log(`   Using optimized index: ${indexUsed ? 'YES ✅' : 'NO ❌'}`);
      
      if (!indexUsed) {
        // Find which index was used
        const planText = JSON.stringify(plan, null, 2);
        const indexMatch = planText.match(/idx_videos_[a-z_]+/);
        if (indexMatch) {
          console.log(`   Actually using: ${indexMatch[0]}`);
        }
      }
      
      if (planningTime < 5) {
        console.log(`\n🎉 EXCELLENT! Planning time is now under 5ms!`);
        const estimatedRate = Math.round(1000 / (planningTime + executionTime));
        console.log(`   Estimated processing rate: ${estimatedRate} videos/second`);
      } else if (planningTime < 10) {
        console.log(`\n✅ GOOD! Planning time is under 10ms`);
        const estimatedRate = Math.round(1000 / (planningTime + executionTime));
        console.log(`   Estimated processing rate: ${estimatedRate} videos/second`);
      } else {
        console.log(`\n⚠️  Planning time is still high (${planningTime.toFixed(2)}ms)`);
        console.log(`   The optimizer might be choosing a different index`);
        
        // Try to force the index usage
        console.log(`\n🔧 Updating table statistics specifically for our columns...`);
        await client.query(`
          ALTER TABLE videos 
          ALTER COLUMN channel_id SET STATISTICS 1000,
          ALTER COLUMN published_at SET STATISTICS 1000,
          ALTER COLUMN is_short SET STATISTICS 1000,
          ALTER COLUMN view_count SET STATISTICS 1000
        `);
        await client.query('ANALYZE videos (channel_id, published_at, is_short, view_count)');
        console.log(`✅ Column statistics updated`);
      }
    }
    
    // Show current configuration
    console.log(`\n📊 Current optimizer settings:`);
    const configResult = await client.query(`
      SELECT name, setting, unit, short_desc
      FROM pg_settings 
      WHERE name IN ('random_page_cost', 'seq_page_cost', 'work_mem', 'effective_cache_size')
      ORDER BY name
    `);
    
    configResult.rows.forEach(row => {
      console.log(`   ${row.name}: ${row.setting} ${row.unit || ''}`);
    });
    
    console.log(`\n💡 If performance is still poor, consider:`);
    console.log(`   1. Your baseline fix script is competing with other queries`);
    console.log(`   2. The database might be under heavy load`);
    console.log(`   3. Network latency between your script and database`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

// Run the optimization
optimizePerformance().catch(console.error);