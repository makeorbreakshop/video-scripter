/**
 * Test script to explore what thumbnail CLIP vectors can reveal
 * and compare with potential Vision API analysis
 */

import { createClient } from '@supabase/supabase-js';
import { pineconeService } from '../lib/pinecone-service.js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeVideoThumbnails(videoId) {
  console.log('\n=== THUMBNAIL ANALYSIS TEST ===');
  console.log(`Testing video: ${videoId}\n`);

  // 1. Get video details
  const { data: video, error } = await supabase
    .from('videos')
    .select('*, channel_name, channel_id, temporal_performance_score, thumbnail_url, title')
    .eq('id', videoId)
    .single();

  if (error || !video) {
    console.error('Video not found:', error);
    return;
  }

  console.log(`📹 Video: "${video.title}"`);
  console.log(`📊 Performance: ${video.temporal_performance_score?.toFixed(1)}x baseline`);
  console.log(`🖼️ Thumbnail: ${video.thumbnail_url}\n`);

  // 2. Find visually similar thumbnails using CLIP vectors
  console.log('🔍 SEARCHING FOR VISUALLY SIMILAR THUMBNAILS...\n');
  
  try {
    // Search in thumbnail namespace
    const similarThumbnails = await pineconeService.searchSimilar(
      null, // We'll need to get the actual vector first
      50,   // Get top 50
      0.0,  // No threshold to see full range
      0,
      'thumbnails' // Thumbnail namespace
    );

    if (similarThumbnails.results.length > 0) {
      console.log(`Found ${similarThumbnails.results.length} similar thumbnails\n`);
      
      // Analyze similarity patterns
      const highPerformers = [];
      const lowPerformers = [];
      const sameChannel = [];
      const differentChannels = [];

      for (const match of similarThumbnails.results) {
        const { data: matchVideo } = await supabase
          .from('videos')
          .select('title, channel_name, channel_id, temporal_performance_score, view_count')
          .eq('id', match.video_id)
          .single();

        if (matchVideo) {
          const result = {
            title: matchVideo.title,
            channel: matchVideo.channel_name,
            score: matchVideo.temporal_performance_score,
            similarity: match.similarity_score,
            views: matchVideo.view_count
          };

          if (matchVideo.temporal_performance_score > 3) {
            highPerformers.push(result);
          } else if (matchVideo.temporal_performance_score < 1) {
            lowPerformers.push(result);
          }

          if (matchVideo.channel_id === video.channel_id) {
            sameChannel.push(result);
          } else {
            differentChannels.push(result);
          }
        }
      }

      // 3. Analyze patterns
      console.log('📊 VISUAL SIMILARITY INSIGHTS:\n');
      
      console.log(`High Performers (>3x) with similar thumbnails: ${highPerformers.length}`);
      if (highPerformers.length > 0) {
        console.log('Top 3:');
        highPerformers.slice(0, 3).forEach(v => {
          console.log(`  - "${v.title.substring(0, 50)}..." (${v.score?.toFixed(1)}x, sim: ${v.similarity.toFixed(3)})`);
        });
      }

      console.log(`\nLow Performers (<1x) with similar thumbnails: ${lowPerformers.length}`);
      if (lowPerformers.length > 0) {
        console.log('Bottom 3:');
        lowPerformers.slice(0, 3).forEach(v => {
          console.log(`  - "${v.title.substring(0, 50)}..." (${v.score?.toFixed(1)}x, sim: ${v.similarity.toFixed(3)})`);
        });
      }

      // 4. Channel-specific insights
      console.log(`\n📺 CHANNEL PATTERNS:\n`);
      console.log(`Same channel videos with similar thumbnails: ${sameChannel.length}`);
      if (sameChannel.length > 0) {
        const avgChannelScore = sameChannel.reduce((sum, v) => sum + (v.score || 0), 0) / sameChannel.length;
        console.log(`Average performance of similar channel thumbnails: ${avgChannelScore.toFixed(1)}x`);
        console.log(`This video's relative performance: ${(video.temporal_performance_score / avgChannelScore).toFixed(1)}x channel's similar thumbnails`);
      }

      console.log(`\nCross-channel matches: ${differentChannels.length}`);
      if (differentChannels.length > 0) {
        // Group by channel
        const channelGroups = {};
        differentChannels.forEach(v => {
          if (!channelGroups[v.channel]) {
            channelGroups[v.channel] = [];
          }
          channelGroups[v.channel].push(v);
        });

        console.log('Channels using similar thumbnail style:');
        Object.entries(channelGroups)
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, 5)
          .forEach(([channel, videos]) => {
            const avgScore = videos.reduce((sum, v) => sum + (v.score || 0), 0) / videos.length;
            console.log(`  - ${channel}: ${videos.length} videos, avg ${avgScore.toFixed(1)}x`);
          });
      }

      // 5. Visual pattern success rate
      console.log(`\n🎯 VISUAL PATTERN SUCCESS RATE:\n`);
      const successRate = (highPerformers.length / similarThumbnails.results.length * 100).toFixed(1);
      console.log(`Success rate of this visual style: ${successRate}%`);
      console.log(`(${highPerformers.length} out of ${similarThumbnails.results.length} similar thumbnails performed >3x)`);

      // 6. Similarity threshold analysis
      console.log(`\n📈 SIMILARITY VS PERFORMANCE:\n`);
      const similarityBuckets = {
        'Very High (>0.8)': [],
        'High (0.7-0.8)': [],
        'Medium (0.6-0.7)': [],
        'Low (0.5-0.6)': [],
        'Very Low (<0.5)': []
      };

      similarThumbnails.results.forEach(match => {
        const sim = match.similarity_score;
        if (sim > 0.8) similarityBuckets['Very High (>0.8)'].push(match);
        else if (sim > 0.7) similarityBuckets['High (0.7-0.8)'].push(match);
        else if (sim > 0.6) similarityBuckets['Medium (0.6-0.7)'].push(match);
        else if (sim > 0.5) similarityBuckets['Low (0.5-0.6)'].push(match);
        else similarityBuckets['Very Low (<0.5)'].push(match);
      });

      for (const [bucket, matches] of Object.entries(similarityBuckets)) {
        if (matches.length > 0) {
          console.log(`${bucket}: ${matches.length} videos`);
        }
      }

    } else {
      console.log('No similar thumbnails found in vector database');
    }

  } catch (err) {
    console.error('Error searching thumbnails:', err);
  }

  // 7. Channel thumbnail evolution
  console.log(`\n🔄 CHANNEL THUMBNAIL EVOLUTION:\n`);
  
  const { data: recentVideos } = await supabase
    .from('videos')
    .select('id, title, published_at, temporal_performance_score')
    .eq('channel_id', video.channel_id)
    .order('published_at', { ascending: false })
    .limit(20);

  if (recentVideos && recentVideos.length > 0) {
    console.log(`Analyzing last ${recentVideos.length} videos from ${video.channel_name}:`);
    
    // Find where this video ranks
    const videoIndex = recentVideos.findIndex(v => v.id === videoId);
    if (videoIndex !== -1) {
      console.log(`This video is #${videoIndex + 1} most recent`);
      
      // Compare to videos before and after
      if (videoIndex > 0) {
        const prevVideo = recentVideos[videoIndex - 1];
        console.log(`Previous video: ${prevVideo.temporal_performance_score?.toFixed(1)}x`);
      }
      if (videoIndex < recentVideos.length - 1) {
        const nextVideo = recentVideos[videoIndex + 1];
        console.log(`Next video: ${nextVideo.temporal_performance_score?.toFixed(1)}x`);
      }
    }

    // Calculate channel's visual consistency (would need actual vector comparison)
    console.log('\nNote: Full visual consistency analysis would require comparing actual vectors');
  }

  return {
    video,
    highPerformers,
    lowPerformers,
    sameChannel,
    differentChannels
  };
}

// Test with multiple videos
async function runTests() {
  console.log('🚀 STARTING THUMBNAIL INSIGHT TESTS\n');
  
  // Test videos - replace with actual video IDs from your database
  const testVideos = [
    '6Pxhj3El-5w', // Light Phone example from earlier
    // Add more test video IDs here
  ];

  for (const videoId of testVideos) {
    await analyzeVideoThumbnails(videoId);
    console.log('\n' + '='.repeat(80) + '\n');
  }
}

// Run the tests
runTests().catch(console.error);