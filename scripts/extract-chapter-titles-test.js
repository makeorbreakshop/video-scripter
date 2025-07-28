#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function extractChapterTitles(description) {
  if (!description) return [];
  
  // Find all timestamp patterns with their titles
  const lines = description.split('\n');
  const chapters = [];
  
  for (const line of lines) {
    // Match various timestamp formats
    // Standard: "0:00 Introduction" or "00:00 Introduction"
    // Also: "Introduction 0:00" or "- 0:00 Introduction"
    const patterns = [
      /^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s+(.+?)$/,  // Timestamp at start
      /^\s*(.+?)\s+\d{1,2}:\d{2}(?::\d{2})?$/,    // Timestamp at end
      /^\s*[-•]\s*\d{1,2}:\d{2}\s+(.+?)$/,        // With bullet
      /^\s*\d{1,2}:\d{2}\s*[-–]\s*(.+?)$/,        // With dash separator
    ];
    
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        let title = match[1].trim();
        
        // Clean up the title
        title = title
          .replace(/^\d+\.\s*/, '')           // Remove leading numbers
          .replace(/^[-•]\s*/, '')            // Remove bullets
          .replace(/\s*[-–]\s*$/, '')         // Remove trailing dashes
          .replace(/\s*\([^)]+\)$/, '')       // Remove parenthetical info
          .replace(/\s{2,}/g, ' ')            // Multiple spaces to single
          .trim();
        
        if (title.length >= 2 && title.length <= 100) {
          chapters.push(title);
        }
        break; // Found match, skip other patterns
      }
    }
  }
  
  // Remove duplicates while preserving order
  return [...new Set(chapters)];
}

async function testChapterExtraction() {
  console.log('🔍 Testing Chapter Title Extraction\n');
  
  // First, get a sample of videos with chapters
  const { data: sampleVideos, error } = await supabase
    .from('videos')
    .select('id, title, description, channel_name')
    .not('description', 'is', null)
    .ilike('description', '%0:00%')
    .limit(20);
  
  if (error) {
    console.error('Error fetching videos:', error);
    return;
  }
  
  console.log(`Found ${sampleVideos.length} videos with potential chapters\n`);
  
  // Test extraction on sample videos
  const results = [];
  
  for (const video of sampleVideos) {
    const chapters = extractChapterTitles(video.description);
    
    if (chapters.length > 0) {
      results.push({
        id: video.id,
        title: video.title.substring(0, 60) + '...',
        channel: video.channel_name,
        chapterCount: chapters.length,
        chapters: chapters.slice(0, 5), // First 5 chapters
        combined: `${video.title} | ${chapters.join(' | ')}`
      });
      
      console.log(`\n📹 ${video.title.substring(0, 60)}...`);
      console.log(`   Channel: ${video.channel_name}`);
      console.log(`   Chapters found: ${chapters.length}`);
      console.log(`   First 5: ${chapters.slice(0, 5).join(' | ')}`);
    }
  }
  
  console.log('\n\n📊 EXTRACTION SUMMARY:');
  console.log(`- Videos analyzed: ${sampleVideos.length}`);
  console.log(`- Videos with extractable chapters: ${results.length}`);
  console.log(`- Average chapters per video: ${(results.reduce((sum, r) => sum + r.chapterCount, 0) / results.length).toFixed(1)}`);
  
  // Now let's get a larger sample for BERTopic testing
  console.log('\n\n🎯 Fetching larger sample for BERTopic test...');
  
  const { data: testVideos, error: testError } = await supabase
    .from('videos')
    .select('id, title, description')
    .not('description', 'is', null)
    .ilike('description', '%0:00%')
    .limit(5000);
  
  if (testError) {
    console.error('Error fetching test videos:', testError);
    return;
  }
  
  console.log(`\nFetched ${testVideos.length} videos for processing`);
  
  // Process all videos and save results
  const processedData = [];
  let validChapterCount = 0;
  
  for (const video of testVideos) {
    const chapters = extractChapterTitles(video.description);
    
    if (chapters.length >= 3) { // Only include videos with meaningful chapters
      validChapterCount++;
      processedData.push({
        id: video.id,
        title: video.title,
        chapters: chapters,
        combined_text: `${video.title} | ${chapters.join(' | ')}`
      });
    }
  }
  
  console.log(`\n✅ Videos with 3+ extractable chapters: ${validChapterCount}`);
  console.log(`   This gives us a good dataset for BERTopic comparison`);
  
  // Save the processed data for next step
  const fs = await import('fs');
  await fs.promises.writeFile(
    'chapter_enhanced_videos.json',
    JSON.stringify(processedData, null, 2)
  );
  
  console.log('\n💾 Saved processed data to chapter_enhanced_videos.json');
  console.log('   Ready for embedding generation and BERTopic comparison');
}

testChapterExtraction().catch(console.error);