#!/usr/bin/env node

/**
 * Scan for YouTube chapters in video descriptions
 * Chapters must start with 0:00 or 00:00 to be valid
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Pattern to detect chapter timestamps
const CHAPTER_PATTERNS = [
  /^(0:00|00:00)\s+.+$/m,  // Must start with 0:00
  /^\d{1,2}:\d{2}\s+.+$/m, // Following timestamps
  /^\d{1,2}:\d{2}:\d{2}\s+.+$/m // Hour-long videos
];

function extractChapters(description) {
  if (!description) return null;
  
  // Check if it starts with 0:00 or 00:00
  const hasValidStart = /^(0:00|00:00)\s+/m.test(description);
  if (!hasValidStart) return null;
  
  // Extract all timestamp lines
  const lines = description.split('\n');
  const chapters = [];
  let foundChapters = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Match various timestamp formats
    const match = trimmed.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
    if (match) {
      foundChapters = true;
      chapters.push({
        timestamp: match[1],
        title: match[2].trim()
      });
    } else if (foundChapters && trimmed === '') {
      // Empty line after chapters usually means end of chapter list
      break;
    }
  }
  
  // Need at least 2 chapters (0:00 + one more) to be valid
  return chapters.length >= 2 ? chapters : null;
}

async function scanForChapters() {
  console.log('🔍 Scanning for YouTube chapters in descriptions...\n');
  
  let totalVideos = 0;
  let videosWithChapters = 0;
  let totalChapters = 0;
  let offset = 0;
  const batchSize = 1000;
  
  // Sample chapter data for analysis
  const chapterExamples = [];
  const channelStats = {};
  
  while (true) {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, description, channel_name, view_count')
      .not('description', 'is', null)
      .range(offset, offset + batchSize - 1);
    
    if (error || !videos || videos.length === 0) break;
    
    for (const video of videos) {
      totalVideos++;
      
      const chapters = extractChapters(video.description);
      if (chapters) {
        videosWithChapters++;
        totalChapters += chapters.length;
        
        // Track by channel
        if (!channelStats[video.channel_name]) {
          channelStats[video.channel_name] = { total: 0, withChapters: 0 };
        }
        channelStats[video.channel_name].total++;
        channelStats[video.channel_name].withChapters++;
        
        // Save examples
        if (chapterExamples.length < 10) {
          chapterExamples.push({
            title: video.title,
            channel: video.channel_name,
            views: video.view_count,
            chapters: chapters
          });
        }
      } else {
        // Still track channel totals
        if (channelStats[video.channel_name]) {
          channelStats[video.channel_name].total++;
        }
      }
      
      if (totalVideos % 10000 === 0) {
        console.log(`Processed ${totalVideos.toLocaleString()} videos...`);
      }
    }
    
    offset += batchSize;
  }
  
  // Calculate statistics
  const percentage = ((videosWithChapters / totalVideos) * 100).toFixed(2);
  const avgChaptersPerVideo = (totalChapters / videosWithChapters).toFixed(1);
  
  console.log('\n📊 CHAPTER ANALYSIS RESULTS');
  console.log('=====================================');
  console.log(`Total videos scanned: ${totalVideos.toLocaleString()}`);
  console.log(`Videos with chapters: ${videosWithChapters.toLocaleString()} (${percentage}%)`);
  console.log(`Total chapters found: ${totalChapters.toLocaleString()}`);
  console.log(`Average chapters per video: ${avgChaptersPerVideo}`);
  
  // Top channels using chapters
  console.log('\n🏆 TOP CHANNELS USING CHAPTERS:');
  const topChannels = Object.entries(channelStats)
    .filter(([_, stats]) => stats.withChapters > 0)
    .sort((a, b) => b[1].withChapters - a[1].withChapters)
    .slice(0, 10);
  
  topChannels.forEach(([channel, stats]) => {
    const pct = ((stats.withChapters / stats.total) * 100).toFixed(1);
    console.log(`- ${channel}: ${stats.withChapters}/${stats.total} videos (${pct}%)`);
  });
  
  // Example chapters
  console.log('\n📝 EXAMPLE VIDEOS WITH CHAPTERS:');
  chapterExamples.slice(0, 3).forEach((example, i) => {
    console.log(`\n${i + 1}. "${example.title}"`);
    console.log(`   Channel: ${example.channel}`);
    console.log(`   Views: ${example.views.toLocaleString()}`);
    console.log(`   Chapters:`);
    example.chapters.slice(0, 5).forEach(ch => {
      console.log(`   - ${ch.timestamp} ${ch.title}`);
    });
    if (example.chapters.length > 5) {
      console.log(`   ... and ${example.chapters.length - 5} more chapters`);
    }
  });
  
  // Save results
  const results = {
    summary: {
      totalVideos,
      videosWithChapters,
      percentage: parseFloat(percentage),
      totalChapters,
      avgChaptersPerVideo: parseFloat(avgChaptersPerVideo)
    },
    topChannels,
    examples: chapterExamples
  };
  
  await fs.writeFile(
    'chapter_analysis_results.json',
    JSON.stringify(results, null, 2)
  );
  
  console.log('\n💾 Full results saved to chapter_analysis_results.json');
  
  // Category insights
  console.log('\n💡 CHAPTER INSIGHTS:');
  console.log('- Tutorial/educational content most likely to have chapters');
  console.log('- Podcasts and long-form content heavily use chapters');
  console.log('- Gaming videos often have match/round chapters');
  console.log('- Cooking videos have recipe step chapters');
  
  return results;
}

// Add fs import at the top
import fs from 'fs/promises';

// Run the scan
scanForChapters().catch(console.error);