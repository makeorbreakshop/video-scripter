#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  console.log('Testing database query...');
  
  // First, let's check if we can connect at all
  const { data: testData, error: testError } = await supabase
    .from('videos')
    .select('id')
    .limit(1);
    
  if (testError) {
    console.error('Basic query failed:', testError);
    return;
  }
  
  console.log('✅ Basic query works');
  
  // Now test the specific query
  const { count, error: countError } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('topic_level_1', null)
    .not('channel_id', 'is', null)
    .not('title_embedding', 'is', null);
    
  if (countError) {
    console.error('Count query failed:', countError);
    console.error('Error details:', JSON.stringify(countError, null, 2));
  } else {
    console.log(`Found ${count} videos needing topic classification`);
  }
}

test().catch(console.error);