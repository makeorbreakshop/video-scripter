/**
 * YouTube Analytics Historical Backfill Script
 * Processes analytics data for existing videos in the database
 */

const { createClient } = require('@supabase/supabase-js');
const { analyticsProcessor } = require('../lib/analytics-processor');

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DAYS_BACK = process.env.BACKFILL_DAYS || 90;
const BATCH_SIZE = process.env.BATCH_SIZE || 10;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log('🚀 Starting YouTube Analytics Historical Backfill');
  console.log(`📅 Backfilling last ${DAYS_BACK} days of data`);
  console.log(`📦 Processing in batches of ${BATCH_SIZE} videos`);
  console.log('─'.repeat(60));

  try {
    // Get all videos from the database
    console.log('📋 Fetching videos from database...');
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, published_at')
      .order('published_at', { ascending: false });

    if (error) {
      throw error;
    }

    if (!videos || videos.length === 0) {
      console.log('ℹ️ No videos found in database');
      return;
    }

    console.log(`✅ Found ${videos.length} videos to process`);

    // Filter for Make or Break Shop videos (you can customize this filter)
    const makeOrBreakVideos = videos.filter(video => {
      // Add your filtering logic here
      // For now, we'll process all videos
      return true;
    });

    console.log(`🎯 Processing ${makeOrBreakVideos.length} videos after filtering`);

    // Calculate date range
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`📅 Date range: ${startDate} to ${endDate}`);
    console.log('─'.repeat(60));

    // Run backfill with progress tracking
    const result = await analyticsProcessor.processMultipleVideos(
      makeOrBreakVideos.map(v => v.id),
      startDate,
      endDate,
      'system', // Use system user for backfill
      (progress) => {
        const percentage = progress.total > 0 ? ((progress.processed / progress.total) * 100).toFixed(1) : '0.0';
        
        if (progress.currentVideo) {
          console.log(`🔄 [${percentage}%] Processing (${progress.processed + 1}/${progress.total}): ${progress.currentVideo}`);
        }
        
        if (progress.errors.length > 0 && progress.errors.length % 5 === 0) {
          console.log(`⚠️ Errors so far: ${progress.errors.length}`);
        }
      }
    );

    console.log('─'.repeat(60));
    console.log('🏁 Backfill Results:');
    console.log(`✅ Success: ${result.success}`);
    console.log(`📊 Total records processed: ${result.processed}`);
    console.log(`📹 Videos processed: ${result.videoIds.length}`);
    console.log(`❌ Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\n🚨 Errors encountered:');
      result.errors.slice(0, 10).forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
      
      if (result.errors.length > 10) {
        console.log(`... and ${result.errors.length - 10} more errors`);
      }
    }

    // Generate summary statistics
    console.log('\n📈 Generating summary statistics...');
    const summary = await analyticsProcessor.getAnalyticsSummary('system', DAYS_BACK);
    
    console.log('─'.repeat(60));
    console.log('📊 Analytics Summary:');
    console.log(`📹 Total videos with data: ${summary.totalVideos}`);
    console.log(`👀 Total views: ${summary.totalViews.toLocaleString()}`);
    console.log(`🎯 Average CTR: ${(summary.averageCTR * 100).toFixed(2)}%`);
    console.log(`⏱️ Average retention: ${(summary.averageRetention * 100).toFixed(2)}%`);
    console.log(`📝 Total analytics records: ${summary.totalRecords}`);

    console.log('\n✅ Backfill complete!');

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️ Backfill interrupted by user');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏹️ Backfill terminated');
  process.exit(0);
});

// Run the backfill
main().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});