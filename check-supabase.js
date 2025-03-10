// Script to check Supabase setup
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSupabaseSetup() {
  console.log('Checking Supabase setup...');
  console.log('Supabase URL:', supabaseUrl);
  console.log('Supabase Anon Key:', supabaseKey ? 'Set ✅' : 'Not set ❌');

  try {
    // Check database tables
    console.log('\nChecking database tables...');
    
    // Check if tables exist
    const tablesResponse = await supabase.rpc('get_schema_info');
    
    if (tablesResponse.error) {
      console.log('Error accessing schema information:', tablesResponse.error.message);
    } else {
      // Check specific tables
      console.log('\nChecking required tables:');
      
      // Projects table
      const { data: projects, error: projectsError } = await supabase
        .from('projects')
        .select('id')
        .limit(1);
      
      console.log('- projects table:', projectsError ? 'Error ❌' : (projects ? 'Exists ✅' : 'Not found ❌'));
      if (projectsError) console.log('  Error:', projectsError.message);
      
      // Documents table
      const { data: documents, error: documentsError } = await supabase
        .from('documents')
        .select('id')
        .limit(1);
      
      console.log('- documents table:', documentsError ? 'Error ❌' : (documents ? 'Exists ✅' : 'Not found ❌'));
      if (documentsError) console.log('  Error:', documentsError.message);
      
      // Script data table
      const { data: scriptData, error: scriptDataError } = await supabase
        .from('script_data')
        .select('id')
        .limit(1);
      
      console.log('- script_data table:', scriptDataError ? 'Error ❌' : (scriptData ? 'Exists ✅' : 'Not found ❌'));
      if (scriptDataError) console.log('  Error:', scriptDataError.message);
    }

    // Check authentication setup
    console.log('\nChecking authentication setup...');
    const { data: authSettings, error: authError } = await supabase.auth.getSession();
    
    console.log('- Auth service:', authError ? 'Error ❌' : 'Working ✅');
    if (authError) console.log('  Error:', authError.message);
    console.log('- Current session:', authSettings?.session ? 'Active ✅' : 'None ❌');

  } catch (error) {
    console.error('Error checking Supabase setup:', error.message);
  }
}

// Run the check
checkSupabaseSetup(); 