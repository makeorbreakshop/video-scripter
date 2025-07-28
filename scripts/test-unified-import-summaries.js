#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

async function testUnifiedImportWithSummaries() {
  console.log('🧪 Testing Unified Import with LLM Summaries\n');
  
  // Test channels with good content
  const testChannels = [
    'UCsnGwSIHyoYN0kiINAGUKxg', // Wolfgang's Channel (woodworking)
    'UC6107grRI4m0o2-emgoDnAA', // Colin Furze (making/engineering)
    'UCjgpFI5dU-D1-kh9H1muoxQ', // Alec Steele (blacksmithing)
  ];
  
  console.log('📺 Testing with channels:');
  testChannels.forEach(id => console.log(`  - ${id}`));
  console.log();
  
  try {
    const response = await fetch('http://localhost:3000/api/video-import/unified', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'competitor',
        channelIds: testChannels,
        options: {
          maxVideosPerChannel: 3, // Just 3 videos per channel for testing
          skipSummaries: false,   // Enable summaries
          summaryModel: 'gpt-4o-mini',
          skipExports: true,      // Skip exports for testing
          skipClassification: true // Skip classification to focus on summaries
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    console.log('Initial response:', JSON.stringify(result, null, 2));
    
    // It's a job-based system, need to wait for completion
    if (result.jobId) {
      console.log('\n⏳ Waiting for job to complete...');
      
      // Poll job status
      let jobComplete = false;
      let jobResult;
      
      while (!jobComplete) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        
        const statusResponse = await fetch(`http://localhost:3000${result.statusUrl}`);
        const status = await statusResponse.json();
        
        console.log(`   Status: ${status.status}`);
        
        if (status.status === 'completed' || status.status === 'failed') {
          jobComplete = true;
          jobResult = status.result;
        }
      }
      
      if (!jobResult) {
        console.log('⚠️  Job completed but no result data');
        return;
      }
      
      console.log('\n📊 Import Results:');
      console.log(`  Videos processed: ${jobResult.videosProcessed}`);
      console.log(`  Summaries generated: ${jobResult.summariesGenerated}`);
      console.log(`  Summary embeddings: ${jobResult.summaryEmbeddingsGenerated}`);
      console.log(`  Title embeddings: ${jobResult.embeddingsGenerated?.titles || 0}`);
      console.log(`  Success: ${jobResult.success}`);
    
      if (jobResult.errors && jobResult.errors.length > 0) {
        console.log('\n⚠️  Errors:');
        jobResult.errors.forEach(err => console.log(`  - ${err}`));
      }
      
      // Now fetch the videos to see the summaries
      if (jobResult.processedVideoIds && jobResult.processedVideoIds.length > 0) {
        console.log('\n📝 Checking generated summaries...\n');
        
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY
        );
        
        const { data: videos } = await supabase
          .from('videos')
          .select('title, channel_name, llm_summary')
          .in('id', jobResult.processedVideoIds)
          .not('llm_summary', 'is', null)
          .limit(10);
      
      if (videos && videos.length > 0) {
        videos.forEach((video, i) => {
          console.log(`${i+1}. "${video.title}"`);
          console.log(`   Channel: ${video.channel_name}`);
          console.log(`   Summary: ${video.llm_summary}\n`);
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
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testUnifiedImportWithSummaries();