#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

async function testConnection() {
  console.log('Testing manual connection parameters...\n');
  
  // Parse the connection string manually
  const url = new URL(process.env.DATABASE_URL);
  
  const config = {
    host: url.hostname,
    port: parseInt(url.port),
    database: url.pathname.substring(1), // Remove leading slash
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false }
  };
  
  console.log('Connection config:');
  console.log('Host:', config.host);
  console.log('Port:', config.port);
  console.log('Database:', config.database);
  console.log('User:', config.user);
  console.log('Password:', config.password.replace(/./g, '*'));
  console.log('');
  
  const pool = new Pool(config);
  
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
  }
}

testConnection();