// Check database tables using ES modules
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase URL or key. Please check your .env.local file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDatabaseTables() {
  console.log('🔍 Checking Database Tables\n');

  // Check for worker_control/worker_controls table
  console.log('1. Checking for worker control tables...');
  const workerControlVariants = ['worker_control', 'worker_controls'];
  
  for (const tableName of workerControlVariants) {
    try {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);
      
      if (!error) {
        console.log(`✅ Found "${tableName}" table`);
        const { count } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
        console.log(`   Total records: ${count}`);
        
        // Get column information
        if (data && data.length > 0) {
          console.log(`   Columns: ${Object.keys(data[0]).join(', ')}`);
        }
      }
    } catch (e) {
      // Table doesn't exist
    }
  }

  // Check videos table for llm_summary column
  console.log('\n2. Checking videos table for llm_summary column...');
  try {
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .limit(1);
    
    if (!error && data && data.length > 0) {
      console.log('✅ Found videos table');
      const columns = Object.keys(data[0]);
      console.log(`   Total columns: ${columns.length}`);
      
      // Check for specific columns
      const llmColumns = columns.filter(col => col.includes('llm_summary'));
      if (llmColumns.length > 0) {
        console.log(`   ✅ LLM Summary columns found: ${llmColumns.join(', ')}`);
      } else {
        console.log('   ❌ No llm_summary columns found');
      }
      
      // Show all columns for reference
      console.log('\n   All columns in videos table:');
      columns.sort().forEach(col => {
        console.log(`   - ${col}`);
      });
    }
  } catch (e) {
    console.error('❌ Error checking videos table:', e.message);
  }

  // List all tables in the database
  console.log('\n3. Getting all tables in the database...');
  try {
    const { data, error } = await supabase.rpc('get_all_tables');
    
    if (error) {
      // If RPC doesn't exist, try a different approach
      console.log('   (Using alternative method to list tables)');
      
      // Try common table names
      const commonTables = [
        'videos', 'chunks', 'comments', 'patterns', 'scripts',
        'baseline_analytics', 'daily_analytics', 'skyscraper_analyses',
        'analyses', 'profiles', 'projects', 'documents', 'script_data',
        'jobs', 'youtube_quota_usage', 'youtube_quota_calls',
        'worker_control', 'worker_controls', 'video_summaries',
        'summary_generation_queue', 'view_snapshots', 'view_tracking_priority',
        'video_performance_trends'
      ];
      
      const foundTables = [];
      for (const table of commonTables) {
        try {
          const { error } = await supabase.from(table).select('*', { count: 'exact', head: true });
          if (!error) {
            foundTables.push(table);
          }
        } catch (e) {
          // Table doesn't exist
        }
      }
      
      console.log(`\n   Found ${foundTables.length} tables:`);
      foundTables.sort().forEach(table => {
        console.log(`   - ${table}`);
      });
    } else if (data) {
      console.log(`\n   Found ${data.length} tables`);
      data.forEach(table => {
        console.log(`   - ${table.table_name}`);
      });
    }
  } catch (e) {
    console.error('   Error listing tables:', e.message);
  }
}

// Run the check
checkDatabaseTables().catch(console.error);