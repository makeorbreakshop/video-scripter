// This script lists sample data from key tables in the database
// Run with: node scripts/list-table-data.js <tableName>
// Example: node scripts/list-table-data.js videos

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or key. Please check your .env.local file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Get a list of all tables in the public schema
async function listAllTables() {
  try {
    const { data, error } = await supabase.from('pg_catalog.pg_tables')
      .select('tablename')
      .eq('schemaname', 'public');

    if (error) {
      console.error('Error fetching tables:', error);
      return [];
    }

    return data.map(row => row.tablename);
  } catch (error) {
    console.error('Error listing tables:', error);
    return [];
  }
}

// Get sample data from a specific table
async function getSampleData(tableName, limit = 3) {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(limit);

    if (error) {
      console.error(`Error fetching data from ${tableName}:`, error);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`Error getting sample data for ${tableName}:`, error);
    return null;
  }
}

// Count rows in a table
async function countRows(tableName) {
  try {
    const { count, error } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.error(`Error counting rows in ${tableName}:`, error);
      return -1;
    }

    return count;
  } catch (error) {
    console.error(`Error counting rows for ${tableName}:`, error);
    return -1;
  }
}

// Search for tables containing a specific pattern in their name
async function findTables(pattern) {
  const allTables = await listAllTables();
  return allTables.filter(table => table.includes(pattern));
}

// Find tables that might contain transcripts or comments
async function findRelevantTables() {
  const allTables = await listAllTables();
  
  // Look for tables that might contain video data, transcripts, or comments
  const videoTables = allTables.filter(table => 
    table.includes('video') || 
    table.includes('transcript') || 
    table.includes('comment') || 
    table.includes('chunk'));
  
  return videoTables;
}

// Main function
async function main() {
  // Get the table name from command line args
  const tableName = process.argv[2];
  
  if (tableName) {
    // If a specific table is requested, show data from that table
    console.log(`Fetching data from table: ${tableName}`);
    const count = await countRows(tableName);
    console.log(`Table ${tableName} contains ${count} rows.`);
    
    if (count > 0) {
      const data = await getSampleData(tableName, 3);
      if (data) {
        console.log(`Sample data from ${tableName}:`);
        console.log(JSON.stringify(data, null, 2));
      }
    }
  } else {
    // If no table specified, show all tables and focus on relevant ones
    const allTables = await listAllTables();
    console.log('All tables in the database:');
    console.log(allTables.join(', '));
    
    console.log('\nSearching for video-related tables...');
    const relevantTables = await findRelevantTables();
    console.log('Relevant tables found:');
    console.log(relevantTables.join(', '));
    
    // Show row counts for relevant tables
    console.log('\nRow counts for relevant tables:');
    for (const table of relevantTables) {
      const count = await countRows(table);
      console.log(`${table}: ${count} rows`);
    }
    
    // For tables with data, show sample content
    console.log('\nSample data for tables with content:');
    for (const table of relevantTables) {
      const count = await countRows(table);
      if (count > 0) {
        const data = await getSampleData(table, 1);
        if (data) {
          console.log(`\n${table} (${count} rows):`);
          console.log('First record properties:');
          const record = data[0];
          Object.keys(record).forEach(key => {
            const value = record[key];
            const displayValue = typeof value === 'string' && value.length > 100 
              ? value.substring(0, 100) + '...' 
              : value;
            console.log(`  ${key}: ${displayValue}`);
          });
        }
      }
    }
  }
}

main().catch(console.error); 