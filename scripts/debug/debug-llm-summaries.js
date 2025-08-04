import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debug() {
  console.log('🔍 Debugging LLM Summary Status...\n');

  // Get total count of videos without summaries
  const { count: needsSummaries } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('llm_summary', null);

  console.log(`📊 Videos needing summaries: ${needsSummaries}`);

  // Get sample of videos without summaries
  const { data: sampleMissing, error } = await supabase
    .from('videos')
    .select('id, title')
    .is('llm_summary', null)
    .order('id', { ascending: true })
    .limit(10);

  if (sampleMissing && sampleMissing.length > 0) {
    console.log('\n📋 Sample videos without summaries (sorted by ID):');
    sampleMissing.forEach(v => {
      console.log(`  - ${v.id}: ${v.title?.substring(0, 50)}...`);
    });
  }

  // Check what happens with the "greater than" query
  const lastId = 'ZzZ_zZFcr80';
  const { data: afterLastId, count: afterCount } = await supabase
    .from('videos')
    .select('id', { count: 'exact' })
    .is('llm_summary', null)
    .gt('id', lastId)
    .limit(5);

  console.log(`\n🔍 Videos with ID > '${lastId}': ${afterCount || 0}`);
  if (afterLastId && afterLastId.length > 0) {
    console.log('Found:', afterLastId);
  }

  // Get the actual range of IDs needing summaries
  const { data: minMax } = await supabase
    .from('videos')
    .select('id')
    .is('llm_summary', null)
    .order('id', { ascending: true })
    .limit(1);

  const { data: maxId } = await supabase
    .from('videos')
    .select('id')
    .is('llm_summary', null)
    .order('id', { ascending: false })
    .limit(1);

  console.log(`\n📏 ID range of videos needing summaries:`);
  console.log(`  Min ID: ${minMax?.[0]?.id || 'none'}`);
  console.log(`  Max ID: ${maxId?.[0]?.id || 'none'}`);
  console.log(`  Last processed: ${lastId}`);

  // Check if we should restart from beginning
  if (maxId?.[0]?.id && maxId[0].id < lastId) {
    console.log(`\n⚠️  All remaining videos have IDs less than the last processed ID!`);
    console.log(`   The worker should restart from the beginning.`);
  }
}

debug().catch(console.error);