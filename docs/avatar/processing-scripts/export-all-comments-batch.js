#!/usr/bin/env node
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

dotenv.config();

const MAKE_OR_BREAK_SHOP_CHANNEL_ID = 'UCjWkNxpp3UHdEavpM_19--Q';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function exportAllComments() {
  console.log('🚀 Exporting ALL quality comments...');
  
  let allComments = [];
  const years = [2020, 2021, 2022, 2023, 2024, 2025];
  
  for (const year of years) {
    console.log(`\n📅 Processing year ${year}...`);
    
    const { data, error } = await supabase
      .from('youtube_comments')
      .select('comment_id, video_id, video_title, comment_text, author_name, published_at, like_count, reply_count')
      .eq('channel_id', MAKE_OR_BREAK_SHOP_CHANNEL_ID)
      .gte('published_at', `${year}-01-01`)
      .lt('published_at', `${year + 1}-01-01`)
      .not('comment_text', 'is', null);
    
    if (error) {
      console.error(`❌ Error for year ${year}:`, error);
      continue;
    }
    
    // Filter spam
    const filtered = data.filter(c => {
      const text = c.comment_text || '';
      if (text.length <= 50) return false;
      if (text.includes('http') && text.split('http').length > 3) return false;
      if (text.includes('youtube.com/post/')) return false;
      if (text.includes('MyBest.Tools')) return false;
      if (text.includes('woodplans.works')) return false;
      if (text.includes('BUY NOW')) return false;
      if (text.includes('₹')) return false;
      if (text.includes('$$$')) return false;
      if (text.includes('►►►')) return false;
      if (text.includes('0:05') && text.includes('0:30')) return false;
      return true;
    });
    
    console.log(`   Found ${data.length} comments, kept ${filtered.length} after filtering`);
    allComments.push(...filtered);
  }
  
  // Save results
  const outputPath = path.join(process.cwd(), 'docs', 'customer-avatar-all-comments.json');
  fs.writeFileSync(outputPath, JSON.stringify(allComments, null, 2));
  
  console.log(`\n✅ COMPLETE! Exported ${allComments.length} quality comments`);
  console.log(`📁 Saved to: ${outputPath}`);
  
  return allComments;
}

exportAllComments().then(comments => {
  console.log(`\n📊 Final count: ${comments.length} comments ready for analysis`);
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
