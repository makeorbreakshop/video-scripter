#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testBaselineProcessing() {
  console.log('🧪 Testing baseline processing with different batch sizes...\n');

  // Test 1: Check the function response format
  console.log('Test 1: Checking RPC response format...');
  try {
    const { data, error } = await supabase.rpc('trigger_temporal_baseline_processing', { 
      batch_size: 1  // Just process 1 video to test
    });
    
    if (error) {
      console.error('❌ RPC call failed:', error);
    } else {
      console.log('✅ RPC response:', JSON.stringify(data, null, 2));
      console.log(`   Type: ${typeof data}`);
      console.log(`   Has videos_updated: ${data?.videos_updated !== undefined}`);
      console.log(`   Videos updated: ${data?.videos_updated || 0}`);
    }
  } catch (err) {
    console.error('❌ Unexpected error:', err);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 2: Test with small batch (should succeed)
  console.log('Test 2: Processing small batch (10 videos)...');
  const startTime = Date.now();
  
  try {
    const { data, error } = await supabase.rpc('trigger_temporal_baseline_processing', { 
      batch_size: 10
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    if (error) {
      console.error(`❌ Small batch failed after ${duration}s:`, error);
    } else {
      const videosProcessed = data?.videos_updated || data?.count || 0;
      console.log(`✅ Small batch succeeded in ${duration}s`);
      console.log(`   Videos processed: ${videosProcessed}`);
    }
  } catch (err) {
    console.error('❌ Unexpected error:', err);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 3: Test with medium batch (new recommended size)
  console.log('Test 3: Processing medium batch (100 videos - new default)...');
  const startTime2 = Date.now();
  
  try {
    const { data, error } = await supabase.rpc('trigger_temporal_baseline_processing', { 
      batch_size: 100
    });
    
    const duration = ((Date.now() - startTime2) / 1000).toFixed(2);
    
    if (error) {
      if (error.code === '57014') {
        console.error(`⚠️  Medium batch timed out after ${duration}s - chunk size may still be too large`);
      } else {
        console.error(`❌ Medium batch failed after ${duration}s:`, error);
      }
    } else {
      const videosProcessed = data?.videos_updated || data?.count || 0;
      console.log(`✅ Medium batch succeeded in ${duration}s`);
      console.log(`   Videos processed: ${videosProcessed}`);
    }
  } catch (err) {
    console.error('❌ Unexpected error:', err);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 4: Simulate the chunked processing logic
  console.log('Test 4: Simulating chunked processing (like unified-video-import)...');
  
  const totalVideos = 250;  // Simulate processing 250 videos
  const chunkSize = 100;    // Using new chunk size
  const totalChunks = Math.ceil(totalVideos / chunkSize);
  let processedCount = 0;
  
  for (let i = 0; i < totalChunks; i++) {
    const currentChunkSize = Math.min(chunkSize, totalVideos - (i * chunkSize));
    
    try {
      console.log(`📊 Processing chunk ${i + 1}/${totalChunks} (${currentChunkSize} videos)...`);
      const chunkStart = Date.now();
      
      const { data, error } = await supabase.rpc('trigger_temporal_baseline_processing', { 
        batch_size: currentChunkSize
      });
      
      const chunkDuration = ((Date.now() - chunkStart) / 1000).toFixed(2);
      
      if (error) {
        console.error(`❌ Chunk ${i + 1} failed after ${chunkDuration}s:`, error);
      } else {
        // This is the fix we implemented
        const videosProcessed = data?.videos_updated || data?.count || 0;
        processedCount += videosProcessed;
        console.log(`✅ Chunk ${i + 1}/${totalChunks} complete in ${chunkDuration}s (processed ${videosProcessed} videos)`);
      }
      
      // Add delay between chunks (as in the fix)
      if (i < totalChunks - 1) {
        console.log('   Waiting 500ms before next chunk...');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
    } catch (error) {
      console.error(`❌ Chunk ${i + 1} error:`, error);
    }
  }
  
  console.log(`\n✅ Chunked processing complete: ${processedCount} total videos processed`);

  console.log('\n' + '='.repeat(50) + '\n');
  console.log('🎯 Test Summary:');
  console.log('- Check if small batches (10) complete quickly');
  console.log('- Check if medium batches (100) complete without timeout');
  console.log('- Check if the response parsing works correctly');
  console.log('- If 100-video batches still timeout, consider reducing to 50');
  
  process.exit(0);
}

testBaselineProcessing().catch(console.error);