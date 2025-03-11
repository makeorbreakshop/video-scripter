/**
 * Simple script to execute the Skyscraper Analysis Framework schema in Supabase
 * Run with: node setup-skyscraper-schema-simple.js
 * 
 * For detailed documentation, see skyscraper-schema-simple-README.md
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

// Get the Supabase credentials from environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // You'll need to add this to your .env.local

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials in .env.local');
  console.error('Make sure you have NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY defined');
  process.exit(1);
}

// Create Supabase client with service role key for admin privileges
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function executeSQL() {
  try {
    console.log('Reading SQL file...');
    const sql = fs.readFileSync('./sql/skyscraper-schema-simple.sql', 'utf8');
    
    console.log('Executing SQL...');
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      console.error('Error executing SQL:', error);
    } else {
      console.log('Schema setup complete!');
      console.log('Result:', data);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

// Note: You need to create the exec_sql function in Supabase first
// Run this SQL in the Supabase SQL editor:
/*
CREATE OR REPLACE FUNCTION exec_sql(sql_query text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE sql_query;
  RETURN 'SQL executed successfully';
END;
$$;
*/

console.log('Before running this script, make sure you have created the exec_sql function in Supabase.');
console.log('Check the comment in the script for the SQL to create this function.');
console.log('This script will create the simplified skyscraper_analyses table.');

executeSQL(); 