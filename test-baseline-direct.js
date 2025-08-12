#!/usr/bin/env node

/**
 * Direct test of TemporalBaselineProcessor
 */

import { TemporalBaselineProcessor } from './lib/temporal-baseline-processor.ts';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testProcessor() {
  console.log('🧪 Testing TemporalBaselineProcessor directly');
  
  // Verify DATABASE_URL is available
  if (!process.env.DATABASE_URL) {
    console.log('❌ DATABASE_URL not found in environment');
    return;
  }
  
  console.log('✅ DATABASE_URL found');
  
  const processor = new TemporalBaselineProcessor();
  
  try {
    console.log('📊 Testing with 3 videos...');
    const result = await processor.processRecentVideos(3);
    
    console.log('📋 Result:', result);
    
    if (result.success) {
      console.log(`✅ SUCCESS: Processed ${result.processedVideos} videos`);
      if (result.processedVideos > 0) {
        console.log('🎯 Fix is working - videos were processed');
      } else {
        console.log('ℹ️ No videos needed processing');
      }
    } else {
      console.log(`❌ FAILED: ${result.error}`);
      console.log('🔧 Fix needs more work');
    }
    
  } catch (error) {
    console.log('❌ EXCEPTION:', error.message);
    console.log('🔧 Fix needs more work');
  } finally {
    await processor.close();
  }
}

testProcessor().catch(console.error);