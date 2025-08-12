#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

console.log('Testing simple pg connection...');
console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function test() {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM videos');
    console.log('✅ SUCCESS! Video count:', result.rows[0].count);
  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error('Error code:', error.code);
  } finally {
    await pool.end();
  }
}

test();