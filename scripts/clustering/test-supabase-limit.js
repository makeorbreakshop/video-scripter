import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testQueries() {
  console.log('🧪 Testing Supabase query limits...\n');
  
  // Get total count
  const { count } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
  console.log(`Total videos in database: ${count?.toLocaleString()}\n`);
  
  // Test different offset ranges
  const testRanges = [
    [0, 999],
    [10000, 10999],
    [50000, 50999],
    [100000, 100999],
    [150000, 150999],
    [170000, 170999]
  ];
  
  for (const [start, end] of testRanges) {
    const { data, error } = await supabase
      .from('videos')
      .select('id')
      .range(start, end)
      .order('id');
    
    if (error) {
      console.log(`❌ Range ${start}-${end}: ERROR - ${error.message}`);
    } else {
      console.log(`✅ Range ${start}-${end}: ${data?.length} videos retrieved`);
    }
  }
  
  // Test without order
  console.log('\nTesting without ORDER BY:');
  const { data: unordered, error: unorderedError } = await supabase
    .from('videos')
    .select('id')
    .range(0, 999);
  
  if (unorderedError) {
    console.log(`❌ Unordered query: ERROR - ${unorderedError.message}`);
  } else {
    console.log(`✅ Unordered query: ${unordered?.length} videos retrieved`);
  }
  
  // Test cumulative fetch
  console.log('\nTesting cumulative fetch:');
  let total = 0;
  let offset = 0;
  const batchSize = 10000;
  
  while (offset < 200000) {  // Try up to 200K
    const { data, error } = await supabase
      .from('videos')
      .select('id')
      .range(offset, offset + batchSize - 1);
    
    if (error) {
      console.log(`❌ Offset ${offset}: ERROR - ${error.message}`);
      break;
    }
    
    if (!data || data.length === 0) {
      console.log(`📍 No more data at offset ${offset}`);
      break;
    }
    
    total += data.length;
    console.log(`  Offset ${offset}: ${data.length} videos (total so far: ${total})`);
    
    if (data.length < batchSize) {
      console.log(`📍 Last batch at offset ${offset}`);
      break;
    }
    
    offset += batchSize;
  }
  
  console.log(`\n📊 Final total fetched: ${total}`);
}

testQueries().catch(console.error);