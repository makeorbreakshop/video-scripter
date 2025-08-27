#!/usr/bin/env node
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

async function addRandomSort() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🎲 Adding random_sort column to videos table...');
    
    // Step 1: Add column without default (instant)
    try {
      await pool.query('ALTER TABLE videos ADD COLUMN random_sort float');
      console.log('✅ Column added successfully');
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('⚠️  Column already exists, continuing...');
      } else {
        throw err;
      }
    }
    
    // Step 2: Count rows needing update
    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM videos WHERE random_sort IS NULL'
    );
    const totalRows = parseInt(countResult.rows[0].total);
    console.log(`📊 Found ${totalRows.toLocaleString()} rows to update`);
    
    if (totalRows === 0) {
      console.log('✨ All rows already have random_sort values!');
      return;
    }
    
    // Step 3: Update in batches
    const batchSize = 25000; // Larger batches for faster updates
    let updated = 0;
    
    while (updated < totalRows) {
      const result = await pool.query(`
        UPDATE videos 
        SET random_sort = random() 
        WHERE id IN (
          SELECT id FROM videos 
          WHERE random_sort IS NULL 
          LIMIT ${batchSize}
        )
      `);
      
      updated += result.rowCount;
      const progress = ((updated / totalRows) * 100).toFixed(1);
      console.log(`⚡ Updated ${updated.toLocaleString()}/${totalRows.toLocaleString()} rows (${progress}%)`);
    }
    
    console.log('✅ All rows updated!');
    
    // Step 4: Create index
    console.log('📇 Creating index on random_sort...');
    await pool.query('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_random_sort ON videos(random_sort)');
    console.log('✅ Index created successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addRandomSort().catch(console.error);