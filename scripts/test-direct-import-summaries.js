#!/usr/bin/env node

import { VideoImportService } from '../lib/unified-video-import.ts';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testDirectImportWithSummaries() {
  console.log('🧪 Testing Direct Import with LLM Summaries\n');
  
  const importService = new VideoImportService();
  
  // Test with a few specific videos
  const testVideoIds = [
    'J---aiyznGQ', // Keyboard Cat
    'ZZ5LpwO-An4', // HEYYEYAAEYAAAEYAEYAA
    'kffacxfA7G4', // Justin Bieber - Baby
  ];
  
  console.log('📺 Testing with videos:', testVideoIds);
  
  try {
    const result = await importService.processVideos({
      source: 'discovery',
      videoIds: testVideoIds,
      options: {
        skipSummaries: false,
        summaryModel: 'gpt-4o-mini',
        skipExports: true,
        skipClassification: true
      }
    });
    
    console.log('\n📊 Import Results:');
    console.log(`  Videos processed: ${result.videosProcessed}`);
    console.log(`  Summaries generated: ${result.summariesGenerated}`);
    console.log(`  Summary embeddings: ${result.summaryEmbeddingsGenerated}`);
    console.log(`  Title embeddings: ${result.embeddingsGenerated.titles}`);
    console.log(`  Success: ${result.success}`);
    
    if (result.errors && result.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      result.errors.forEach(err => console.log(`  - ${err}`));
    }
    
    // Check the summaries
    if (result.processedVideoIds && result.processedVideoIds.length > 0) {
      console.log('\n📝 Generated Summaries:\n');
      
      const { data: videos } = await supabase
        .from('videos')
        .select('title, channel_name, llm_summary, description')
        .in('id', result.processedVideoIds)
        .not('llm_summary', 'is', null);
      
      if (videos && videos.length > 0) {
        videos.forEach((video, i) => {
          console.log(`${i+1}. "${video.title}"`);
          console.log(`   Channel: ${video.channel_name}`);
          console.log(`   Summary: ${video.llm_summary}`);
          console.log(`   Description preview: ${video.description?.substring(0, 100)}...\n`);
        });
        
        // Quality checks
        console.log('✨ Quality Analysis:');
        const issues = [];
        videos.forEach((video, i) => {
          const lower = video.llm_summary?.toLowerCase() || '';
          if (lower.includes('video')) issues.push(`Summary ${i+1} contains "video"`);
          if (lower.includes('tutorial')) issues.push(`Summary ${i+1} contains "tutorial"`);
          if (lower.includes('channel')) issues.push(`Summary ${i+1} contains "channel"`);
        });
        
        if (issues.length === 0) {
          console.log('✅ All summaries pass quality checks!');
        } else {
          console.log('⚠️  Issues found:');
          issues.forEach(issue => console.log(`   - ${issue}`));
        }
      } else {
        console.log('⚠️  No summaries found in database');
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testDirectImportWithSummaries();