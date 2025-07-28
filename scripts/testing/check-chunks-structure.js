// Script to specifically analyze the chunks table structure
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Supabase URL or key not found in environment variables');
  console.error('Please make sure you have set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeChunksTable() {
  console.log('📊 ANALYZING CHUNKS TABLE STRUCTURE');
  console.log('===================================');

  try {
    // 1. Check if chunks table exists and get sample records
    const { data: chunksData, error: chunksError } = await supabase
      .from('chunks')
      .select('*')
      .limit(3);

    if (chunksError) {
      console.error('❌ Error accessing chunks table:', chunksError.message);
      return;
    }

    if (!chunksData || chunksData.length === 0) {
      console.log('⚠️ Chunks table exists but has no records');
      return;
    }

    // 2. Get the total count of records
    const { count, error: countError } = await supabase
      .from('chunks')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('❌ Error counting chunks records:', countError.message);
    } else {
      console.log(`✅ Chunks table exists with ${count} records`);
    }

    // 3. Analyze the table structure based on the first record
    const sampleRecord = chunksData[0];
    console.log('\n📋 TABLE STRUCTURE:');
    console.log('------------------');
    for (const [key, value] of Object.entries(sampleRecord)) {
      const valueType = typeof value;
      const valuePreview = valueType === 'string' ? 
        (value.length > 50 ? `${value.substring(0, 50)}...` : value) : 
        JSON.stringify(value);
      console.log(`${key} (${valueType}): ${valuePreview}`);
    }

    // 4. Check if it has essential fields for video transcript chunks
    const hasVideoId = 'video_id' in sampleRecord;
    const hasContent = 'content' in sampleRecord;
    const hasStartTime = 'start_time' in sampleRecord;
    const hasEndTime = 'end_time' in sampleRecord;
    
    console.log('\n🔍 FIELD ANALYSIS:');
    console.log('----------------');
    console.log(`video_id field: ${hasVideoId ? '✅ Present' : '❌ Missing'}`);
    console.log(`content field: ${hasContent ? '✅ Present' : '❌ Missing'}`);
    console.log(`start_time field: ${hasStartTime ? '✅ Present' : '❌ Missing'}`);
    console.log(`end_time field: ${hasEndTime ? '✅ Present' : '❌ Missing'}`);

    // 5. Sample queries to aid integration
    console.log('\n🧪 SAMPLE QUERIES:');
    console.log('---------------');
    console.log('// Query to fetch all chunks for a specific video:');
    console.log("const { data, error } = await supabase");
    console.log("  .from('chunks')");
    console.log("  .select('*')");
    console.log("  .eq('video_id', 'YOUR_VIDEO_ID')");
    console.log("  .order('start_time', { ascending: true });");

    console.log('\n// Query to get full transcript for a video:');
    console.log("const { data, error } = await supabase");
    console.log("  .from('chunks')");
    console.log("  .select('content, start_time, end_time')");
    console.log("  .eq('video_id', 'YOUR_VIDEO_ID')");
    console.log("  .order('start_time', { ascending: true });");
    console.log("  ");
    console.log("// Combine all chunks into a single transcript");
    console.log("const fullTranscript = data.map(chunk => chunk.content).join('\\n\\n');");
    
    // 6. Display sample data
    console.log('\n📝 SAMPLE DATA:');
    console.log('-------------');
    console.log(JSON.stringify(chunksData[0], null, 2));

  } catch (error) {
    console.error('❌ Unexpected error analyzing chunks table:', error);
  }
}

// Run the analysis
analyzeChunksTable().catch(console.error); 