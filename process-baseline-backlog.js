#!/usr/bin/env node

/**
 * Process the backlog of videos needing temporal baselines
 */

import { TemporalBaselineProcessor } from './lib/temporal-baseline-processor.ts';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function processBacklog() {
  console.log('🔄 Processing temporal baseline backlog');
  
  const processor = new TemporalBaselineProcessor();
  
  try {
    console.log('📊 Processing all videos that need baselines...');
    // Use a large number to process all pending videos
    const result = await processor.processRecentVideos(2000);
    
    console.log('📋 Final Result:', result);
    
    if (result.success) {
      console.log(`✅ SUCCESS: Processed ${result.processedVideos} videos`);
    } else {
      console.log(`❌ FAILED: ${result.error}`);
    }
    
  } catch (error) {
    console.log('❌ EXCEPTION:', error.message);
    console.log(error.stack);
  } finally {
    await processor.close();
  }
}

processBacklog().catch(console.error);