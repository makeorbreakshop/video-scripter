#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

console.log('Raw DATABASE_URL from env:');
console.log(process.env.DATABASE_URL);

console.log('\nParsed URL components:');
const url = new URL(process.env.DATABASE_URL);
console.log('Protocol:', url.protocol);
console.log('Username:', url.username);
console.log('Password:', url.password);
console.log('Host:', url.hostname);
console.log('Port:', url.port);
console.log('Database:', url.pathname);

// Test what pg library sees
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

console.log('\nPool configuration:');
console.log('Host:', pool.options.host);
console.log('Port:', pool.options.port);
console.log('Database:', pool.options.database);
console.log('User:', pool.options.user);
console.log('Password length:', pool.options.password?.length);