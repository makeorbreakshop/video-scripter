import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or key. Please check your .env file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnose() {
  console.log('🔍 DIAGNOSING LLM SUMMARY ELIGIBILITY ISSUE\n');
  console.log('==========================================\n');

  try {
    // 1. Check total videos
    const { count: totalCount, error: totalError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    console.log(`1. Total videos in database: ${totalCount?.toLocaleString() || 'ERROR'}`);
    if (totalError) console.error('   Error:', totalError.message);

    // 2. Check videos with llm_summary = null
    const { count: nullSummaryCount, error: nullError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary', null);
    
    console.log(`2. Videos with llm_summary = NULL: ${nullSummaryCount?.toLocaleString() || 'ERROR'}`);
    if (nullError) console.error('   Error:', nullError.message);

    // 3. Check videos with empty llm_summary
    const { count: emptySummaryCount, error: emptyError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('llm_summary', '');
    
    console.log(`3. Videos with llm_summary = '': ${emptySummaryCount?.toLocaleString() || 'ERROR'}`);
    if (emptyError) console.error('   Error:', emptyError.message);

    // 4. Check videos with any llm_summary
    const { count: hasSummaryCount, error: hasError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('llm_summary', 'is', null)
      .not('llm_summary', 'eq', '');
    
    console.log(`4. Videos with llm_summary populated: ${hasSummaryCount?.toLocaleString() || 'ERROR'}`);
    if (hasError) console.error('   Error:', hasError.message);

    // 5. Get a sample video to check fields
    const { data: sampleVideo, error: sampleError } = await supabase
      .from('videos')
      .select('*')
      .limit(1)
      .single();
    
    if (sampleVideo) {
      console.log('\n📋 SAMPLE VIDEO FIELDS:');
      console.log('======================');
      Object.keys(sampleVideo).forEach(key => {
        const value = sampleVideo[key];
        const preview = value === null ? 'NULL' : 
                       value === '' ? "'' (empty string)" :
                       typeof value === 'string' && value.length > 50 ? 
                       value.substring(0, 50) + '...' : 
                       JSON.stringify(value);
        console.log(`${key}: ${preview}`);
      });
    }

    // 6. Check the exact query from the script
    console.log('\n🎯 TESTING EXACT QUERY FROM submit-llm-summary-single-batch.js:');
    console.log('==============================================================');
    
    const { data: eligibleVideos, error: eligibleError, count } = await supabase
      .from('videos')
      .select('id, title, channel_name, description, view_count', { count: 'exact' })
      .is('llm_summary', null)
      .order('view_count', { ascending: false })
      .limit(10);
    
    if (eligibleError) {
      console.error('❌ Query failed:', eligibleError.message);
      console.log('\nTrying with video_id instead of id...');
      
      const { data: retryVideos, error: retryError, count: retryCount } = await supabase
        .from('videos')
        .select('video_id, title, channel_name, description, view_count', { count: 'exact' })
        .is('llm_summary', null)
        .order('view_count', { ascending: false })
        .limit(10);
      
      if (!retryError) {
        console.log(`✅ Found ${retryCount} eligible videos using video_id`);
        if (retryVideos && retryVideos.length > 0) {
          console.log('\nTop eligible videos:');
          retryVideos.slice(0, 5).forEach(v => {
            console.log(`- ${v.title} (${v.view_count?.toLocaleString()} views)`);
          });
        }
      } else {
        console.error('❌ Retry also failed:', retryError.message);
      }
    } else {
      console.log(`✅ Found ${count} eligible videos`);
      if (eligibleVideos && eligibleVideos.length > 0) {
        console.log('\nTop eligible videos:');
        eligibleVideos.slice(0, 5).forEach(v => {
          console.log(`- ${v.title} (${v.view_count?.toLocaleString()} views)`);
        });
      }
    }

    // 7. Check specific channel
    console.log('\n🔍 CHECKING SPECIFIC CHANNEL:');
    console.log('=============================');
    
    const { data: makeOrBreak, count: mobCount, error: mobError } = await supabase
      .from('videos')
      .select('video_id, title, llm_summary', { count: 'exact' })
      .eq('channel_title', 'Make or Break Shop')
      .limit(5);
    
    if (!mobError) {
      console.log(`Found ${mobCount} videos from 'Make or Break Shop'`);
      if (makeOrBreak && makeOrBreak.length > 0) {
        makeOrBreak.forEach(v => {
          const summaryStatus = v.llm_summary === null ? 'NULL' : 
                               v.llm_summary === '' ? 'EMPTY' : 
                               'HAS SUMMARY';
          console.log(`- ${v.title} [${summaryStatus}]`);
        });
      }
    } else {
      // Try with channel_name instead
      const { data: mobRetry, count: mobRetryCount } = await supabase
        .from('videos')
        .select('video_id, title, llm_summary', { count: 'exact' })
        .eq('channel_name', 'Make or Break Shop')
        .limit(5);
      
      if (mobRetry) {
        console.log(`Found ${mobRetryCount} videos using channel_name`);
      }
    }

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

diagnose().catch(console.error);