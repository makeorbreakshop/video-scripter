#!/usr/bin/env node
/**
 * Batch classify performance for all videos using the existing API endpoint
 * This will calculate envelope_performance_ratio and envelope_performance_category for all 172K videos
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function batchClassifyAllVideos() {
  console.log('🎯 Batch Performance Classification for All Videos');
  console.log('=' .repeat(60));

  // Get total video count
  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('channel_id', 'is', null)
    .not('view_count', 'is', null);

  console.log(`📊 Total videos to process: ${totalVideos.toLocaleString()}`);

  // Check how many already have ratios
  const { count: withRatios } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('envelope_performance_ratio', 'is', null);

  console.log(`✅ Videos already classified: ${withRatios?.toLocaleString() || 0}`);
  console.log(`🔄 Videos needing classification: ${(totalVideos - (withRatios || 0)).toLocaleString()}`);

  if (withRatios === totalVideos) {
    console.log('🎉 All videos already classified!');
    return;
  }

  const batchSize = 100; // Process 100 videos at a time
  let processed = 0;
  let offset = 0;

  console.log(`\n🚀 Starting batch processing (${batchSize} videos per batch)...`);

  while (processed < totalVideos) {
    try {
      // Get batch of video IDs that need classification
      const { data: videoBatch, error } = await supabase
        .from('videos')
        .select('id')
        .not('channel_id', 'is', null)
        .not('view_count', 'is', null)
        .is('envelope_performance_ratio', null) // Only get unclassified videos
        .range(offset, offset + batchSize - 1);

      if (error) {
        console.error('Error fetching video batch:', error);
        break;
      }

      if (!videoBatch || videoBatch.length === 0) {
        console.log('✅ No more videos to process');
        break;
      }

      const videoIds = videoBatch.map(v => v.id);
      console.log(`\n📦 Processing batch ${Math.floor(offset/batchSize) + 1}: ${videoIds.length} videos`);

      // Call our API endpoint
      const response = await fetch('http://localhost:3000/api/performance/classify-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_ids: videoIds,
          update_database: true
        })
      });

      if (!response.ok) {
        console.error(`❌ API call failed for batch at offset ${offset}:`, response.status);
        console.error(await response.text());
        offset += batchSize;
        continue;
      }

      const result = await response.json();
      processed += result.total_videos;

      // Show progress and category breakdown
      console.log(`   ✅ Classified: ${result.total_videos} videos`);
      console.log(`   📈 Categories: Viral(${result.categories_summary.viral}) Outperforming(${result.categories_summary.outperforming}) OnTrack(${result.categories_summary.on_track}) Under(${result.categories_summary.underperforming}) Poor(${result.categories_summary.poor})`);
      console.log(`   🎯 Progress: ${processed.toLocaleString()}/${totalVideos.toLocaleString()} (${((processed/totalVideos)*100).toFixed(1)}%)`);

      offset += batchSize;

      // Brief pause to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`❌ Error processing batch at offset ${offset}:`, error.message);
      offset += batchSize;
      continue;
    }
  }

  // Final statistics
  console.log('\n🎉 Batch Classification Complete!');
  
  const { count: finalWithRatios } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('envelope_performance_ratio', 'is', null);

  console.log(`📊 Final Results:`);
  console.log(`   Total videos processed: ${processed.toLocaleString()}`);
  console.log(`   Videos now classified: ${finalWithRatios?.toLocaleString() || 0}`);
  console.log(`   Classification coverage: ${finalWithRatios ? ((finalWithRatios/totalVideos)*100).toFixed(1) : 0}%`);

  // Show category breakdown
  const categoryQuery = await supabase
    .from('videos')
    .select('envelope_performance_category')
    .not('envelope_performance_category', 'is', null);

  if (categoryQuery.data) {
    const categories = categoryQuery.data.reduce((acc, v) => {
      acc[v.envelope_performance_category] = (acc[v.envelope_performance_category] || 0) + 1;
      return acc;
    }, {});

    console.log(`\n📈 Final Category Distribution:`);
    for (const [category, count] of Object.entries(categories)) {
      const percentage = ((count / finalWithRatios) * 100).toFixed(1);
      console.log(`   ${category}: ${count.toLocaleString()} (${percentage}%)`);
    }
  }
}

// Run the batch classification
batchClassifyAllVideos().catch(console.error);