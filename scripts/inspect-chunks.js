// Script to inspect the chunks table using the existing app's Supabase client
const { supabase } = require('../lib/supabase');

async function inspectChunksTable() {
  console.log('📊 INSPECTING CHUNKS TABLE');
  console.log('==========================');

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

    // 4. Display sample data
    console.log('\n📝 SAMPLE DATA:');
    console.log('-------------');
    console.log(JSON.stringify(chunksData[0], null, 2));

  } catch (error) {
    console.error('❌ Unexpected error inspecting chunks table:', error);
  }
}

// Run the inspection
inspectChunksTable().catch(console.error); 