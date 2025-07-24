/**
 * Test Performance Calculations Directly
 * This tests our performance envelope logic without the API
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function calculateChannelBaseline(channelId) {
  console.log(`\n📊 Calculating baseline for channel: ${channelId}`);
  
  // Get first-week snapshots
  const { data: snapshots, error } = await supabase
    .from('view_snapshots')
    .select('view_count')
    .eq('channel_id', channelId)
    .lte('days_since_published', 7)
    .not('view_count', 'is', null);

  if (error || !snapshots || snapshots.length === 0) {
    console.log('❌ No first-week data available');
    return null;
  }

  // Calculate trimmed statistics (exclude top/bottom 10%)
  const sortedViews = snapshots
    .map(s => s.view_count)
    .sort((a, b) => a - b);

  const trimStart = Math.floor(sortedViews.length * 0.1);
  const trimEnd = Math.ceil(sortedViews.length * 0.9);
  const trimmedViews = sortedViews.slice(trimStart, trimEnd);

  const median = trimmedViews[Math.floor(trimmedViews.length / 2)];
  const confidence = Math.min(snapshots.length / 30, 1.0);

  return {
    baseline: median,
    confidence: confidence,
    video_count: snapshots.length,
    min_views: trimmedViews[0],
    max_views: trimmedViews[trimmedViews.length - 1]
  };
}

async function classifyVideo(videoId) {
  console.log(`\n🎯 Classifying video: ${videoId}`);
  
  // Get video details
  const { data: video, error: videoError } = await supabase
    .from('videos')
    .select('id, title, channel_id, view_count, published_at')
    .eq('id', videoId)
    .single();

  if (videoError || !video) {
    console.log('❌ Video not found');
    return null;
  }

  // Calculate days since published
  const daysSincePublished = Math.floor(
    (Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  console.log(`Video: ${video.title}`);
  console.log(`Current views: ${video.view_count.toLocaleString()}`);
  console.log(`Days since published: ${daysSincePublished}`);

  // Get channel baseline
  const baseline = await calculateChannelBaseline(video.channel_id);
  const effectiveBaseline = baseline?.baseline || 8478; // Use Day 1 median as fallback

  // Get envelope data
  const { data: envelopeData } = await supabase
    .from('performance_envelopes')
    .select('day_since_published, p50_views')
    .in('day_since_published', [1, Math.min(daysSincePublished, 365)]);

  if (!envelopeData || envelopeData.length < 2) {
    console.log('❌ Insufficient envelope data');
    return null;
  }

  const day1Data = envelopeData.find(d => d.day_since_published === 1);
  const currentDayData = envelopeData.find(d => d.day_since_published === Math.min(daysSincePublished, 365));

  const globalShapeMultiplier = currentDayData.p50_views / day1Data.p50_views;
  const expectedViews = effectiveBaseline * globalShapeMultiplier;
  const performanceRatio = video.view_count / expectedViews;

  let category, description;
  if (performanceRatio > 3.0) {
    category = 'viral';
    description = 'Viral (>3x expected)';
  } else if (performanceRatio >= 1.5) {
    category = 'outperforming';
    description = 'Outperforming (1.5-3x expected)';
  } else if (performanceRatio >= 0.5) {
    category = 'on_track';
    description = 'On Track (0.5-1.5x expected)';
  } else if (performanceRatio >= 0.2) {
    category = 'underperforming';
    description = 'Underperforming (0.2-0.5x expected)';
  } else {
    category = 'poor';
    description = 'Poor (<0.2x expected)';
  }

  console.log(`\n📈 Performance Analysis:`);
  console.log(`Expected views: ${Math.round(expectedViews).toLocaleString()}`);
  console.log(`Performance ratio: ${performanceRatio.toFixed(2)}x`);
  console.log(`Category: ${description}`);
  console.log(`Channel baseline: ${effectiveBaseline.toLocaleString()} views`);
  console.log(`Global shape multiplier: ${globalShapeMultiplier.toFixed(2)}x`);

  return {
    video_id: videoId,
    title: video.title,
    performance_ratio: performanceRatio,
    category: category,
    description: description,
    actual_views: video.view_count,
    expected_views: Math.round(expectedViews)
  };
}

async function testCalculations() {
  console.log('🧪 Testing Performance Envelope Calculations\n');

  try {
    // 1. Test with a few channels
    console.log('1️⃣ Testing Channel Baselines:');
    
    const { data: channels } = await supabase
      .from('view_snapshots')
      .select('channel_id')
      .lte('days_since_published', 7)
      .not('channel_id', 'is', null)
      .limit(3);

    if (channels && channels.length > 0) {
      const uniqueChannels = [...new Set(channels.map(c => c.channel_id))];
      
      for (const channelId of uniqueChannels.slice(0, 2)) {
        const baseline = await calculateChannelBaseline(channelId);
        if (baseline) {
          console.log(`\nChannel ${channelId}:`);
          console.log(`  Baseline: ${baseline.baseline.toLocaleString()} views`);
          console.log(`  Confidence: ${(baseline.confidence * 100).toFixed(0)}%`);
          console.log(`  Based on: ${baseline.video_count} videos`);
        }
      }
    }

    // 2. Test video classification
    console.log('\n\n2️⃣ Testing Video Classification:');
    
    // Get videos with different performance levels
    const { data: videos } = await supabase
      .from('videos')
      .select('id')
      .not('view_count', 'is', null)
      .order('view_count', { ascending: false })
      .limit(20);

    if (videos && videos.length > 0) {
      // Test a high-performing video
      await classifyVideo(videos[0].id);
      
      // Test a medium-performing video
      await classifyVideo(videos[10].id);
      
      // Test a lower-performing video
      await classifyVideo(videos[19].id);
    }

    // 3. Show envelope curve sample
    console.log('\n\n3️⃣ Sample Envelope Curve Data:');
    const { data: envelopeSample } = await supabase
      .from('performance_envelopes')
      .select('day_since_published, p50_views')
      .in('day_since_published', [0, 1, 7, 30, 90, 180, 365])
      .order('day_since_published');

    if (envelopeSample) {
      console.log('\nMedian expected views by age:');
      envelopeSample.forEach(e => {
        console.log(`  Day ${e.day_since_published}: ${e.p50_views.toLocaleString()} views`);
      });
    }

    console.log('\n✅ Testing complete!');

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the tests
testCalculations().catch(console.error);