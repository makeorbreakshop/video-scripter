#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

async function testConnection() {
  console.log('Testing Supabase pooler connection...');
  console.log('Connection string:', process.env.DATABASE_URL?.replace(/:[^@]+@/, ':****@'));
  
  // Try with prepared statements disabled
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 0,
    idle_in_transaction_session_timeout: 0,
    options: '-c statement_timeout=0'
  });

  try {
    const client = await pool.connect();
    console.log('✅ Connected successfully!');
    
    const result = await client.query('SELECT COUNT(*) FROM videos');
    console.log('Video count:', result.rows[0].count);
    
    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ Connection failed:', error.message);
    console.error('Error code:', error.code);
    console.error('Full error:', error);
  }
}

testConnection();