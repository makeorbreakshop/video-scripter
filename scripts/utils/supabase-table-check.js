// Script to check Supabase tables for the application
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSupabaseTables() {
  console.log('Checking Supabase tables...');
  
  try {
    // Check projects table
    const { data: projectsData, error: projectsError } = await supabase
      .from('projects')
      .select('*')
      .limit(1);
    
    console.log('Projects table:', projectsError ? `Error: ${projectsError.message}` : 'OK');
    console.log('Projects data:', projectsData);
    
    // Check documents table
    const { data: documentsData, error: documentsError } = await supabase
      .from('documents')
      .select('*')
      .limit(1);
    
    console.log('Documents table:', documentsError ? `Error: ${documentsError.message}` : 'OK');
    console.log('Documents data:', documentsData);
    
    // Check script_data table
    const { data: scriptData, error: scriptDataError } = await supabase
      .from('script_data')
      .select('*')
      .limit(1);
    
    console.log('Script_data table:', scriptDataError ? `Error: ${scriptDataError.message}` : 'OK');
    console.log('Script_data data:', scriptData);
    
  } catch (error) {
    console.error('Error checking tables:', error);
  }
}

checkSupabaseTables(); 