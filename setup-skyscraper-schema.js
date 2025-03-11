/**
 * Script to execute the Skyscraper Analysis schema in Supabase
 * Run with: node setup-skyscraper-schema.js
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

// Get the Supabase credentials from environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // You'll need to add this to your .env.local

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.local');
  process.exit(1);
}

if (!serviceRoleKey) {
  console.error('IMPORTANT: For schema changes, you need a service_role key.');
  console.error('Add SUPABASE_SERVICE_ROLE_KEY to your .env.local');
  console.error('You can find this in your Supabase dashboard under Project Settings -> API');
  process.exit(1);
}

// Create Supabase client with service role key for admin privileges
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function executeSQL() {
  try {
    console.log('Reading SQL file...');
    const sql = fs.readFileSync('./sql/skyscraper-schema.sql', 'utf8');
    
    // Split the SQL into individual statements
    const statements = sql
      .split(';')
      .map(statement => statement.trim())
      .filter(statement => statement.length > 0);
    
    console.log(`Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement separately
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`Executing statement ${i + 1}/${statements.length}...`);
      
      const { error } = await supabase.rpc('pgexec', { sql: statement + ';' });
      
      if (error) {
        console.error(`Error executing statement ${i + 1}:`, error);
        // Continue with other statements even if one fails
      } else {
        console.log(`Successfully executed statement ${i + 1}`);
      }
    }
    
    console.log('Schema setup complete!');
  } catch (error) {
    console.error('Error:', error);
  }
}

executeSQL(); 