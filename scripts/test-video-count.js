#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testCount() {
  // Count total videos
  const { count: totalCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Total videos: ${totalCount}`);
  
  // Count videos with topics
  const { count: topicCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('topic_level_1', 'is', null);
    
  console.log(`Videos with topics: ${topicCount}`);
  
  // Get sample
  const { data: sample } = await supabase
    .from('videos')
    .select('id, title, view_count, topic_level_1')
    .order('view_count', { ascending: false })
    .limit(5);
    
  console.log('\nTop 5 videos:');
  sample?.forEach(v => {
    console.log(`- ${v.title} (${v.view_count?.toLocaleString()} views, topic: ${v.topic_level_1})`);
  });
}

testCount().catch(console.error);