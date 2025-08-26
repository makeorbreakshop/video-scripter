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

async function runQueries() {
  console.log('🔍 Checking LLM Summary Eligibility\n');
  console.log('====================================\n');

  try {
    // Query 1: Videos with NULL description
    const { count: nullDescCount, error: error1 } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('description', null);
    
    if (error1) throw error1;
    console.log(`1. Videos with NULL description: ${nullDescCount?.toLocaleString() || 0}`);

    // Query 2: Videos with short descriptions (< 50 chars)
    const { data: shortDescData, error: error2 } = await supabase
      .rpc('execute_sql', {
        query: "SELECT COUNT(*) as count FROM videos WHERE description IS NOT NULL AND LENGTH(description) < 50"
      });
    
    if (!error2 && shortDescData) {
      console.log(`2. Videos with short descriptions (< 50 chars): ${shortDescData[0]?.count?.toLocaleString() || 'Unable to count'}`);
    } else {
      // Fallback: fetch and count manually
      const { data: videos, error: fallbackError } = await supabase
        .from('videos')
        .select('description')
        .not('description', 'is', null);
      
      if (!fallbackError && videos) {
        const shortDescCount = videos.filter(v => v.description && v.description.length < 50).length;
        console.log(`2. Videos with short descriptions (< 50 chars): ${shortDescCount.toLocaleString()} (from ${videos.length.toLocaleString()} non-null descriptions)`);
      }
    }

    // Query 3: Make or Break Shop videos
    const { count: makeOrBreakCount, error: error3 } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('channel_title', 'Make or Break Shop');
    
    if (error3) throw error3;
    console.log(`3. Videos from 'Make or Break Shop' channel: ${makeOrBreakCount?.toLocaleString() || 0}`);

    // Query 4: Channels with LLM summaries
    const { data: channelSummaries, error: error4 } = await supabase
      .from('videos')
      .select('channel_title')
      .not('llm_summary', 'is', null)
      .not('llm_summary', 'eq', '');
    
    if (error4) throw error4;
    
    // Count by channel
    const channelCounts = {};
    channelSummaries?.forEach(v => {
      channelCounts[v.channel_title] = (channelCounts[v.channel_title] || 0) + 1;
    });
    
    const sortedChannels = Object.entries(channelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    console.log('\n4. Top 10 channels with LLM summaries:');
    sortedChannels.forEach(([channel, count]) => {
      console.log(`   ${channel}: ${count.toLocaleString()} videos`);
    });

    // Additional checks for eligibility
    console.log('\n🔍 ADDITIONAL ELIGIBILITY CHECKS\n');
    console.log('================================\n');

    // Check total videos
    const { count: totalVideos, error: errorTotal } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    if (!errorTotal) {
      console.log(`Total videos in database: ${totalVideos?.toLocaleString() || 0}`);
    }

    // Check videos without LLM summary
    const { count: noSummaryCount, error: errorNoSummary } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .or('llm_summary.is.null,llm_summary.eq.');
    
    if (!errorNoSummary) {
      console.log(`Videos without LLM summary: ${noSummaryCount?.toLocaleString() || 0}`);
    }

    // Check videos with transcripts (chunks table)
    const { count: videosWithChunks, error: errorChunks } = await supabase
      .from('chunks')
      .select('video_id', { count: 'exact', head: true });
    
    if (!errorChunks) {
      console.log(`Videos with transcript chunks: ${videosWithChunks?.toLocaleString() || 0}`);
    }

    // Sample check - what fields do we have?
    const { data: sampleVideo, error: sampleError } = await supabase
      .from('videos')
      .select('*')
      .limit(1)
      .single();
    
    if (!sampleError && sampleVideo) {
      console.log('\n📋 AVAILABLE VIDEO FIELDS:');
      console.log('=========================');
      const fields = Object.keys(sampleVideo);
      console.log(fields.join(', '));
      
      // Check specifically for fields that might affect eligibility
      console.log('\n🔑 KEY ELIGIBILITY FIELDS:');
      console.log('==========================');
      console.log(`has_llm_summary field: ${'llm_summary' in sampleVideo ? '✅' : '❌'}`);
      console.log(`has_description field: ${'description' in sampleVideo ? '✅' : '❌'}`);
      console.log(`has_transcript field: ${'transcript' in sampleVideo ? '✅' : '❌'}`);
      console.log(`has_duration field: ${'duration' in sampleVideo ? '✅' : '❌'}`);
    }

    // Check videos that meet the criteria from your script
    console.log('\n🎯 VIDEOS MATCHING SCRIPT CRITERIA\n');
    console.log('==================================\n');
    
    // This mimics the WHERE clause from scripts/submit-llm-summary-single-batch.js
    const { data: eligibleVideos, error: eligibleError } = await supabase
      .from('videos')
      .select('video_id, title, channel_title, description', { count: 'exact' })
      .or('llm_summary.is.null,llm_summary.eq.')
      .not('description', 'is', null)
      .gt('duration', 0)
      .order('published_at', { ascending: false })
      .limit(10);
    
    if (!eligibleError) {
      console.log(`Videos matching script criteria: ${eligibleVideos?.length || 0}`);
      if (eligibleVideos && eligibleVideos.length > 0) {
        console.log('\nSample eligible videos:');
        eligibleVideos.slice(0, 5).forEach(v => {
          console.log(`- ${v.title} (${v.channel_title})`);
          console.log(`  Description: ${v.description?.substring(0, 100)}...`);
        });
      }
    }

    // Check the actual count with the exact criteria
    const { count: exactEligibleCount, error: exactError } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .or('llm_summary.is.null,llm_summary.eq.')
      .not('description', 'is', null)
      .gt('duration', 0);
    
    if (!exactError) {
      console.log(`\n✅ EXACT count of eligible videos: ${exactEligibleCount?.toLocaleString() || 0}`);
    }

  } catch (error) {
    console.error('Error running queries:', error);
  }
}

runQueries().catch(console.error);