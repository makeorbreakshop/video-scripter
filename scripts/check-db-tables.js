// This script checks the available tables in the database
// Run with: node scripts/check-db-tables.js

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or key. Please check your .env.local file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function listTables() {
  try {
    // Query to list all tables in the public schema
    const { data, error } = await supabase.from('pg_catalog.pg_tables')
      .select('tablename')
      .eq('schemaname', 'public');

    if (error) {
      console.error('Error fetching tables:', error);
      return;
    }

    console.log('=== Available tables in the public schema: ===');
    if (data && data.length > 0) {
      data.forEach((row, index) => {
        console.log(`${index + 1}. ${row.tablename}`);
      });
    } else {
      console.log('No tables found in the public schema.');
    }

    // For each table, describe its structure
    if (data && data.length > 0) {
      console.log('\n=== Table structures: ===');
      for (const table of data) {
        const tableName = table.tablename;
        console.log(`\nTable: ${tableName}`);
        
        // Get column information for the table
        const { data: columns, error: columnsError } = await supabase
          .rpc('system_info_columns', { table_name: tableName });
        
        if (columnsError) {
          console.error(`Error fetching columns for ${tableName}:`, columnsError);
          continue;
        }
        
        if (columns && columns.length > 0) {
          console.log('Columns:');
          columns.forEach(col => {
            console.log(`  - ${col.column_name} (${col.data_type}${col.is_nullable === 'NO' ? ', NOT NULL' : ''})`);
          });
        } else {
          console.log('No columns found for this table.');
        }
      }
    }
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Check if we have access to RPC
async function checkRPC() {
  try {
    const { data, error } = await supabase.rpc('system_info_columns', { table_name: 'videos' });
    
    if (error) {
      console.log('\n=== RPC not available or not set up ===');
      console.log('We need to use a different method to describe tables.');
      return false;
    }
    
    return true;
  } catch (error) {
    console.log('\n=== RPC not available or not set up ===');
    return false;
  }
}

// Alternative method to check columns if RPC is not available
async function listColumns(tableName) {
  try {
    // Make a simple SELECT query to the table and get the first record
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);
    
    if (error) {
      console.error(`Error querying ${tableName}:`, error);
      return;
    }
    
    if (data && data.length > 0) {
      console.log(`\nTable: ${tableName}`);
      console.log('Columns:');
      const columns = Object.keys(data[0]);
      columns.forEach(col => {
        console.log(`  - ${col} (type: ${typeof data[0][col]})`);
      });
    } else {
      console.log(`\nTable: ${tableName} (empty)`);
    }
  } catch (error) {
    console.error(`Unexpected error for ${tableName}:`, error);
  }
}

// Run the main function
async function main() {
  console.log('Checking database tables...');
  await listTables();
  
  const rpcAvailable = await checkRPC();
  
  if (!rpcAvailable) {
    // If RPC is not available, try to describe some key tables directly
    console.log('\n=== Alternative method to check key tables: ===');
    const keyTables = ['videos', 'transcripts', 'comments', 'skyscraper_analyses'];
    for (const table of keyTables) {
      await listColumns(table);
    }
  }
  
  console.log('\nDatabase check complete.');
}

main().catch(console.error); 