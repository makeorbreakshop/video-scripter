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

async function fixInstitutionalFlags() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    // First, check how many mismatches we have
    console.log('\n📊 Checking for mismatches...');
    const mismatchCheck = await client.query(`
      SELECT 
        COUNT(*) as total_mismatches,
        COUNT(DISTINCT v.channel_id) as affected_channels
      FROM videos v
      JOIN channels c ON v.channel_id = c.channel_id
      WHERE v.is_institutional != c.is_institutional;
    `);
    
    console.log(`Found ${mismatchCheck.rows[0].total_mismatches} mismatched videos across ${mismatchCheck.rows[0].affected_channels} channels`);
    
    // Show some examples
    const examples = await client.query(`
      SELECT 
        v.channel_name,
        v.channel_id,
        COUNT(*) as mismatched_videos,
        c.is_institutional as should_be_institutional
      FROM videos v
      JOIN channels c ON v.channel_id = c.channel_id
      WHERE v.is_institutional != c.is_institutional
      GROUP BY v.channel_name, v.channel_id, c.is_institutional
      ORDER BY COUNT(*) DESC
      LIMIT 10;
    `);
    
    console.log('\n📋 Top channels with mismatches:');
    examples.rows.forEach(row => {
      console.log(`  - ${row.channel_name}: ${row.mismatched_videos} videos (should be institutional: ${row.should_be_institutional})`);
    });
    
    // Fix the mismatches
    console.log('\n🔧 Fixing institutional flags to match channels table...');
    const startTime = Date.now();
    
    const result = await client.query(`
      UPDATE videos v
      SET is_institutional = c.is_institutional
      FROM channels c
      WHERE v.channel_id = c.channel_id
        AND v.is_institutional != c.is_institutional;
    `);
    
    const duration = Date.now() - startTime;
    console.log(`✅ Updated ${result.rowCount} videos in ${(duration / 1000).toFixed(2)} seconds`);
    
    // Verify the fix
    console.log('\n🔍 Verifying fix...');
    const verifyCheck = await client.query(`
      SELECT COUNT(*) as remaining_mismatches
      FROM videos v
      JOIN channels c ON v.channel_id = c.channel_id
      WHERE v.is_institutional != c.is_institutional;
    `);
    
    if (verifyCheck.rows[0].remaining_mismatches === '0') {
      console.log('✅ All institutional flags are now consistent!');
    } else {
      console.log(`⚠️ Still ${verifyCheck.rows[0].remaining_mismatches} mismatches remaining`);
    }
    
    // Show current institutional channel stats
    console.log('\n📊 Current institutional channels:');
    const stats = await client.query(`
      SELECT 
        c.channel_name,
        COUNT(v.id) as video_count
      FROM channels c
      JOIN videos v ON v.channel_id = c.channel_id
      WHERE c.is_institutional = true
      GROUP BY c.channel_name
      ORDER BY COUNT(v.id) DESC
      LIMIT 15;
    `);
    
    stats.rows.forEach(row => {
      console.log(`  - ${row.channel_name}: ${row.video_count} videos`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed');
  }
}

// Run the script
fixInstitutionalFlags();