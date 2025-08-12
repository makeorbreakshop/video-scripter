#!/usr/bin/env node

/**
 * Fix temporal baselines for all remaining videos using direct PostgreSQL connection
 * Bypasses Supabase API timeouts by connecting directly to PostgreSQL
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

async function fixTemporalBaselines() {
  // Get database URL from environment
  const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_URL;
  
  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL or DIRECT_URL environment variable');
    console.log('\n💡 Get your direct connection string from:');
    console.log('   Supabase Dashboard > Settings > Database > Connection String > URI');
    console.log('   Add it to your .env file as DATABASE_URL=postgres://...');
    return;
  }

  const client = new Client(parseConnectionString(DATABASE_URL));

  try {
    console.log('🔌 Connecting directly to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // Set a long timeout for this session
    await client.query("SET statement_timeout = '2h'");
    console.log('⏱️  Set statement timeout to 2 hours\n');

    console.log('🔧 Starting temporal baseline fix...');
    console.log('📊 This will process all remaining videos needing baseline fixes\n');
    
    let totalProcessed = 0;
    let totalFirstVideos = 0;
    let totalOtherVideos = 0;
    let batchCount = 0;
    
    const startTime = Date.now();
    
    // Start with batch size for first videos
    let batchSize = 1500;
    
    while (true) {
      batchCount++;
      
      try {
        console.log(`🔄 Running batch ${batchCount} with size ${batchSize}...`);
        const batchStartTime = Date.now();
        
        // Call the corrected safe fix function using direct SQL
        console.log('   📡 Executing SQL function...');
        const result = await client.query('SELECT fix_temporal_baselines_safe($1) as result', [batchSize]);
        const batchTime = (Date.now() - batchStartTime) / 1000;
        console.log(`   ⏱️  Batch completed in ${batchTime.toFixed(1)} seconds`);
        
        const data = result.rows[0]?.result;
        
        console.log('   🔍 Raw result:', JSON.stringify(data, null, 2));
        
        if (!data) {
          console.error(`❌ Batch ${batchCount} failed: No result returned`);
          console.error('   Full result object:', JSON.stringify(result.rows, null, 2));
          break;
        }
        
        const videosUpdated = data.total_updated || 0;
        const totalRemaining = (data.remaining_first_videos || 0) + (data.remaining_other_videos || 0);
        
        // Get detailed breakdown from the result
        const firstVideosFixed = data.first_videos_fixed || 0;
        const otherVideosFixed = data.other_videos_fixed || 0;
        
        totalProcessed += videosUpdated;
        totalFirstVideos += firstVideosFixed;
        totalOtherVideos += otherVideosFixed;
        
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = totalProcessed / elapsed;
        const eta = totalRemaining > 0 ? Math.round(totalRemaining / rate) : 0;
        
        console.log(`✅ Batch ${batchCount} Results:`);
        console.log(`   Total Updated: ${videosUpdated}`);
        console.log(`   Total Remaining: ${totalRemaining}`);
        console.log(`   Processing Rate: ${Math.round(rate)} videos/second`);
        if (eta > 0) console.log(`   ETA: ${eta} seconds`);
        console.log('');
        
        // If no videos were updated, we're done
        if (videosUpdated === 0) {
          console.log('✨ All videos processed!');
          break;
        }
        
        // After first batch (which should handle most first videos), reduce batch size
        if (batchCount === 1) {
          batchSize = 500;
          console.log('📉 Reducing batch size to 500 for remaining videos\n');
        }
        
        // Small delay to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (error) {
        console.error(`❌ Unexpected error in batch ${batchCount}:`, error.message);
        break;
      }
    }
    
    const totalTime = (Date.now() - startTime) / 1000;
    
    console.log('='.repeat(60));
    console.log('🎉 COMPLETE!');
    console.log(`📈 Summary:`);
    console.log(`   Total Videos Processed: ${totalProcessed}`);
    console.log(`   First Videos Fixed: ${totalFirstVideos}`);
    console.log(`   Other Videos Fixed: ${totalOtherVideos}`);
    console.log(`   Total Time: ${Math.round(totalTime)} seconds (${batchCount} batches)`);
    console.log(`   Average Rate: ${Math.round(totalProcessed / totalTime)} videos/second`);
    
    // Final verification
    console.log('\n📊 Final verification...');
    
    const statusResult = await client.query('SELECT fix_temporal_baselines_safe($1) as result', [1]);
    const statusCheck = statusResult.rows[0]?.result;
    
    if (statusCheck) {
      const totalRemaining = statusCheck.remaining || 0;
      
      console.log(`   Total Remaining: ${totalRemaining}`);
      
      if (totalRemaining === 0) {
        console.log('✅ All temporal baselines successfully fixed!');
      } else {
        console.log('ℹ️  Some videos still need processing - they may genuinely lack historical data');
      }
    }
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
  } finally {
    await client.end();
    console.log('\n🔌 Disconnected from database');
  }
}

// Run the fix
fixTemporalBaselines().catch(console.error);