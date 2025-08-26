// Quick script to check metadata structure
// Run with: node scripts/check-metadata-structure.js

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkMetadata() {
  // Get a sample of competitor videos with metadata
  const { data, error } = await supabase
    .from('videos')
    .select('channel_id, metadata')
    .eq('is_competitor', true)
    .limit(5);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Sample metadata structures:');
  data.forEach((video, index) => {
    console.log(`\n--- Video ${index + 1} ---`);
    console.log('Channel:', video.channel_id);
    console.log('YouTube Channel ID locations:');
    console.log('- metadata.youtube_channel_id:', video.metadata?.youtube_channel_id);
    console.log('- metadata.channel_id:', video.metadata?.channel_id);
    console.log('- metadata.channelId:', video.metadata?.channelId);
    console.log('- metadata.channel?.id:', video.metadata?.channel?.id);
    console.log('Full metadata keys:', Object.keys(video.metadata || {}));
  });
}

checkMetadata().catch(console.error);