#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStats() {
  // Get a larger sample
  const { data: videos } = await supabase
    .from('videos')
    .select('description')
    .is('llm_summary', null)
    .neq('channel_name', 'Make or Break Shop')
    .limit(10000);
  
  const stats = {
    total: videos.length,
    noDesc: videos.filter(v => !v.description).length,
    empty: videos.filter(v => v.description === '').length,
    under10: videos.filter(v => v.description && v.description.length < 10).length,
    under50: videos.filter(v => v.description && v.description.length < 50).length,
    valid: videos.filter(v => v.description && v.description.length >= 50).length
  };
  
  console.log('Description statistics (sample of 10,000):');
  console.log(`- No description: ${stats.noDesc} (${(stats.noDesc/stats.total*100).toFixed(1)}%)`);
  console.log(`- Empty string: ${stats.empty}`);
  console.log(`- Under 10 chars: ${stats.under10} (${(stats.under10/stats.total*100).toFixed(1)}%)`);
  console.log(`- Under 50 chars: ${stats.under50} (${(stats.under50/stats.total*100).toFixed(1)}%)`);
  console.log(`- Valid (50+ chars): ${stats.valid} (${(stats.valid/stats.total*100).toFixed(1)}%)`);
  
  console.log('\nProjected for all 177,841 videos:');
  console.log(`- Expected valid descriptions: ${Math.round(177841 * stats.valid / stats.total).toLocaleString()}`);
}

checkStats();