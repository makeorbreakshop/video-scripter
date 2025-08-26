#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testVideoModalData() {
  // Get a video with LLM summary
  const { data: video, error } = await supabase
    .from('videos')
    .select('*')
    .not('llm_summary', 'is', null)
    .limit(1)
    .single();
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('📺 Video Data for Modal:');
  console.log('ID:', video.id);
  console.log('Title:', video.title);
  console.log('Channel:', video.channel_name);
  console.log('\n🤖 LLM Summary:', video.llm_summary);
  console.log('Model:', video.llm_summary_model);
  console.log('Generated:', video.llm_summary_generated_at);
  
  // Test channel endpoint
  const channelId = video.channel_id;
  console.log('\n📊 Testing channel endpoint with ID:', channelId);
  
  const response = await fetch(`http://localhost:3000/api/youtube/channels/${encodeURIComponent(channelId)}`);
  const channelData = await response.json();
  
  if (channelData.videos) {
    const videosWithSummaries = channelData.videos.filter(v => v.llm_summary);
    console.log(`Found ${videosWithSummaries.length} videos with LLM summaries out of ${channelData.videos.length} total`);
  }
}

testVideoModalData();