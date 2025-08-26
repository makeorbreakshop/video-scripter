#!/usr/bin/env node

/**
 * Test script to verify temporal baseline processor fix
 */

import { TemporalBaselineProcessor } from './lib/temporal-baseline-processor.ts';

async function testTemporalBaseline() {
  console.log('🧪 Testing Temporal Baseline Processor Fix');
  
  const processor = new TemporalBaselineProcessor();
  
  try {
    // Test with a small batch first
    console.log('📊 Testing with 5 videos...');
    const result = await processor.processRecentVideos(5);
    
    if (result.success) {
      console.log(`✅ SUCCESS: Processed ${result.processedVideos} videos`);
      console.log('🎯 Fix is working correctly');
    } else {
      console.log(`❌ FAILED: ${result.error}`);
      console.log('🔧 Fix still needs work');
    }
    
  } catch (error) {
    console.log('❌ ERROR during test:', error.message);
    console.log('🔧 Fix still needs work');
  } finally {
    await processor.close();
  }
}

testTemporalBaseline().catch(console.error);