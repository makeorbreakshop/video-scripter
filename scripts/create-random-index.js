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

async function createIndex() {
  const client = new Client({ connectionString });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();

    // Disable timeouts for this session
    console.log('⚙️ Configuring session...');
    await client.query('SET statement_timeout = 0');
    
    // Check if index already exists
    const checkQuery = `
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'videos' 
      AND indexname = 'idx_videos_random_sort';
    `;
    
    const { rows } = await client.query(checkQuery);
    
    if (rows.length > 0) {
      console.log('✅ Index idx_videos_random_sort already exists');
      return;
    }

    // Create the index
    console.log('📊 Creating index on random_sort column...');
    console.log('This may take a minute for 660K rows...');
    
    const startTime = Date.now();
    
    await client.query(`
      CREATE INDEX CONCURRENTLY idx_videos_random_sort 
      ON videos(random_sort)
      WHERE is_short = false 
        AND is_institutional = false;
    `);
    
    const duration = Date.now() - startTime;
    console.log(`✅ Index created successfully in ${(duration / 1000).toFixed(2)} seconds`);

    // Verify the index
    const verifyQuery = `
      SELECT 
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE tablename = 'videos' 
      AND indexname = 'idx_videos_random_sort';
    `;
    
    const verifyResult = await client.query(verifyQuery);
    
    if (verifyResult.rows.length > 0) {
      console.log('\n📋 Index details:');
      console.log(verifyResult.rows[0].indexdef);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔌 Connection closed');
  }
}

// Run the script
createIndex();