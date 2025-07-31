// Simple script to check database structure
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or key. Please check your .env.local file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Try to query all video records
async function checkVideosTable() {
  console.log('Checking videos table...');
  
  try {
    const { data, error, count } = await supabase
      .from('videos')
      .select('*', { count: 'exact' })
      .limit(1);
    
    if (error) {
      console.error('Error querying videos table:', error.message);
      return false;
    }
    
    console.log(`✅ Found videos table with ${count} records.`);
    
    if (data && data.length > 0) {
      console.log('Sample video record fields:', Object.keys(data[0]).join(', '));
    }
    
    return true;
  } catch (error) {
    console.error('Error checking videos table:', error.message);
    return false;
  }
}

// Try to find transcript table
async function findTranscriptTable() {
  console.log('\nSearching for transcript table...');
  
  // Possible table names for transcripts
  const possibleTables = [
    'video_chunks',
    'transcripts',
    'video_transcripts',
    'chunks',
    'transcript_chunks'
  ];
  
  for (const table of possibleTables) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select('*', { count: 'exact' })
        .limit(1);
      
      if (!error) {
        console.log(`✅ Found transcript table "${table}" with ${count} records.`);
        if (data && data.length > 0) {
          console.log(`Sample ${table} record fields:`, Object.keys(data[0]).join(', '));
          
          // Check if this table has video_id to confirm it's related to videos
          if (Object.keys(data[0]).includes('video_id')) {
            console.log(`Confirmed "${table}" has video_id field.`);
          }
        }
        return table;
      }
    } catch (error) {
      // Continue to the next table
    }
  }
  
  console.log('❌ Could not find a transcript table.');
  return null;
}

// Try to find comments table
async function findCommentsTable() {
  console.log('\nSearching for comments table...');
  
  // Possible table names for comments
  const possibleTables = [
    'comments',
    'video_comments',
    'comment_data',
    'yt_comments'
  ];
  
  for (const table of possibleTables) {
    try {
      const { data, error, count } = await supabase
        .from(table)
        .select('*', { count: 'exact' })
        .limit(1);
      
      if (!error) {
        console.log(`✅ Found comments table "${table}" with ${count} records.`);
        if (data && data.length > 0) {
          console.log(`Sample ${table} record fields:`, Object.keys(data[0]).join(', '));
          
          // Check if this table has video_id to confirm it's related to videos
          if (Object.keys(data[0]).includes('video_id')) {
            console.log(`Confirmed "${table}" has video_id field.`);
          }
        }
        return table;
      }
    } catch (error) {
      // Continue to the next table
    }
  }
  
  console.log('❌ Could not find a comments table.');
  return null;
}

// Check if skyscraper_analyses table exists
async function checkSkyscraperAnalysesTable() {
  console.log('\nChecking skyscraper_analyses table...');
  
  try {
    const { data, error, count } = await supabase
      .from('skyscraper_analyses')
      .select('*', { count: 'exact' })
      .limit(1);
    
    if (error) {
      console.error('Error querying skyscraper_analyses table:', error.message);
      return false;
    }
    
    console.log(`✅ Found skyscraper_analyses table with ${count} records.`);
    
    if (data && data.length > 0) {
      console.log('Sample skyscraper_analyses record fields:', Object.keys(data[0]).join(', '));
    }
    
    return true;
  } catch (error) {
    console.error('Error checking skyscraper_analyses table:', error.message);
    return false;
  }
}

// Try to find any other tables that might be related
async function discoverOtherTables() {
  console.log('\nLooking for other tables...');
  
  // Try common table names you might be using
  const tablesToTry = [
    'users',
    'profiles',
    'auth_users',
    'buckets',
    'storage',
    'objects',
    'embeddings',
    'video_metadata',
    'skyscraper_analysis_progress',
    'skyscraper_results'
  ];
  
  const foundTables = [];
  
  for (const table of tablesToTry) {
    try {
      const { error } = await supabase
        .from(table)
        .select('*')
        .limit(1);
      
      if (!error) {
        console.log(`✅ Found table: ${table}`);
        foundTables.push(table);
      }
    } catch (error) {
      // Continue to the next table
    }
  }
  
  if (foundTables.length === 0) {
    console.log('No additional tables found.');
  }
  
  return foundTables;
}

async function examineChunksTableInDetail() {
  console.log('\n📊 DETAILED CHUNKS TABLE EXAMINATION');
  console.log('===================================');

  try {
    // Check if chunks table exists
    const { data: chunksData, error: chunksError } = await supabase
      .from('chunks')
      .select('*')
      .limit(5);

    if (chunksError) {
      console.error('❌ Error accessing chunks table:', chunksError.message);
      return;
    }

    if (!chunksData || chunksData.length === 0) {
      console.log('⚠️ Chunks table exists but has no records');
      return;
    }

    console.log(`✅ Found chunks table with data`);

    // Display detailed structure of the first record
    const sampleRecord = chunksData[0];
    console.log('\n📋 CHUNKS TABLE STRUCTURE:');
    console.log('------------------------');
    for (const [key, value] of Object.entries(sampleRecord)) {
      const valueType = typeof value;
      const valuePreview = valueType === 'string' ? 
        (value.length > 50 ? `${value.substring(0, 50)}...` : value) : 
        JSON.stringify(value);
      console.log(`${key} (${valueType}): ${valuePreview}`);
    }

    // Display schema fields that are needed for our application
    console.log('\n🔑 KEY FIELDS FOR APPLICATION:');
    console.log('---------------------------');
    const fields = {
      'video_id': 'video_id' in sampleRecord,
      'content': 'content' in sampleRecord,
      'start_time': 'start_time' in sampleRecord,
      'end_time': 'end_time' in sampleRecord
    };

    for (const [field, exists] of Object.entries(fields)) {
      console.log(`${field}: ${exists ? '✅ Present' : '❌ Missing'}`);
    }

    // Show sample data for the first record
    console.log('\n📝 SAMPLE DATA (1st record):');
    console.log('--------------------------');
    console.log(JSON.stringify(chunksData[0], null, 2));
    
    return chunksData[0];
  } catch (error) {
    console.error('❌ Error examining chunks table:', error);
    return null;
  }
}

// Run all checks
async function main() {
  console.log('🔍 Database Structure Analysis');
  console.log('============================');
  
  // Check for videos table
  const videosExist = await checkVideosTable();
  
  // Find transcript table
  const transcriptTable = await findTranscriptTable();
  
  // Find comments table
  const commentsTable = await findCommentsTable();
  
  // Check skyscraper_analyses table
  const skyscraperAnalysesExist = await checkSkyscraperAnalysesTable();
  
  // Discover other tables
  const otherTables = await discoverOtherTables();
  
  // Add detailed chunks table examination
  await examineChunksTableInDetail();
  
  console.log('\n===== SUMMARY =====');
  console.log(`Videos table: ${videosExist ? 'Found' : 'Not found'}`);
  console.log(`Transcript table: ${transcriptTable || 'Not found'}`);
  console.log(`Comments table: ${commentsTable || 'Not found'}`);
  console.log(`Skyscraper analyses table: ${skyscraperAnalysesExist ? 'Found' : 'Not found'}`);
  console.log(`Other tables found: ${otherTables.length > 0 ? otherTables.join(', ') : 'None'}`);
  
  console.log('\n===== RECOMMENDED ACTION =====');
  if (!videosExist) {
    console.log('❌ Videos table not found. You need to create a videos table first.');
  }
  
  if (!transcriptTable) {
    console.log('❌ No transcript table found. You need to create a table to store video transcripts.');
  }
  
  if (!commentsTable) {
    console.log('❌ No comments table found. You need to create a table to store video comments.');
  }
  
  if (!skyscraperAnalysesExist) {
    console.log('❌ Skyscraper_analyses table not found. You need to create this table for analysis results.');
  }
  
  // Update the skyscraper-analysis.ts file with the correct table names
  if (videosExist && (transcriptTable || commentsTable)) {
    console.log('\n===== UPDATE YOUR CODE =====');
    console.log('Update app/actions/skyscraper-analysis.ts with these table names:');
    console.log(`- Videos table: videos`);
    console.log(`- Transcript table: ${transcriptTable || '[needs to be created]'}`);
    console.log(`- Comments table: ${commentsTable || '[needs to be created]'}`);
    console.log(`- Analysis table: skyscraper_analyses`);
  }
}

main().catch(console.error); 