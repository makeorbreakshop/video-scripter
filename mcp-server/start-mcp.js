#!/usr/bin/env node

// Load environment variables first, before anything else
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load from parent directory .env file
const envPath = process.env.DOTENV_CONFIG_PATH || path.join(__dirname, '..', '.env');
dotenv.config({ path: envPath });

// Verify environment variables are loaded
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('ERROR: Environment variables not loaded properly');
  console.error(`Tried to load from: ${envPath}`);
  console.error('Please ensure .env file exists and contains NEXT_PUBLIC_SUPABASE_URL');
  process.exit(1);
}

// Now import and start the server
import('./dist/index.js').catch(error => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});