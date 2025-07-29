import { ViewTrackingService } from '../lib/view-tracking-service.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function testViewTrackingDirect() {
  console.log('🔍 Testing View Tracking Service directly...\n');
  
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  // Get a small batch of videos to test
  const { data: testVideos, error } = await supabase
    .from('videos')
    .select('id, published_at')
    .limit(5);
    
  if (error) {
    console.error('Error fetching test videos:', error);
    return;
  }
  
  console.log(`Found ${testVideos.length} test videos`);
  
  // Create service instance
  const service = new ViewTrackingService();
  
  // Test processBatch directly (this is a private method, so we'll need to make it public temporarily)
  // For now, let's test the quota tracker
  console.log('\n🔍 Testing quota tracker...');
  const quotaTracker = service.quotaTracker;
  
  // Check if quota is available
  const quotaAvailable = await quotaTracker.checkQuotaAvailable(1);
  console.log(`Quota available: ${quotaAvailable}`);
  
  // Check current quota status
  const { data: quotaStatus } = await supabase.rpc('get_quota_status');
  console.log('\nCurrent quota status:', quotaStatus);
  
  // Test a minimal update
  console.log('\n🔍 Testing minimal updateAllStaleVideos...');
  try {
    // This will process just a few videos to test
    const result = await service.updateAllStaleVideos(0);
    console.log(`✅ Update completed! Processed ${result} videos`);
  } catch (error) {
    console.error('❌ Update failed:', error);
  }
}

testViewTrackingDirect().catch(console.error);