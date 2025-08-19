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

async function getAllCommentsForYear(year) {
  let allData = [];
  let hasMore = true;
  let offset = 0;
  const limit = 1000;
  
  while (hasMore) {
    const { data, error } = await supabase
      .from('youtube_comments')
      .select('comment_id, video_id, video_title, comment_text, author_name, published_at, like_count, reply_count')
      .eq('channel_id', MAKE_OR_BREAK_SHOP_CHANNEL_ID)
      .gte('published_at', `${year}-01-01`)
      .lt('published_at', `${year + 1}-01-01`)
      .not('comment_text', 'is', null)
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) {
      console.error(`Error at offset ${offset}:`, error);
      break;
    }
    
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allData.push(...data);
      console.log(`   Batch ${Math.floor(offset/limit) + 1}: ${data.length} comments (total: ${allData.length})`);
      
      if (data.length < limit) {
        hasMore = false;
      } else {
        offset += limit;
      }
    }
  }
  
  return allData;
}

async function exportAllComments() {
  console.log('🚀 Exporting ALL comments from 2020-2025...');
  
  let allComments = [];
  const years = [2020, 2021, 2022, 2023, 2024, 2025];
  
  for (const year of years) {
    console.log(`\n📅 Processing year ${year}...`);
    const yearComments = await getAllCommentsForYear(year);
    
    // Filter spam
    const filtered = yearComments.filter(c => {
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
      if (text.match(/\b(Click here|CLICK HERE)\b/)) return false;
      return true;
    });
    
    console.log(`   Total for ${year}: ${yearComments.length} comments, kept ${filtered.length} after filtering`);
    allComments.push(...filtered);
  }
  
  // Save results
  const outputPath = path.join(process.cwd(), 'docs', 'customer-avatar-all-comments.json');
  fs.writeFileSync(outputPath, JSON.stringify(allComments, null, 2));
  
  // Create CSV
  const csvPath = path.join(process.cwd(), 'docs', 'customer-avatar-all-comments.csv');
  const csvContent = [
    'comment_id,video_title,comment_text,author_name,published_at,like_count,reply_count',
    ...allComments.map(c => 
      `"${c.comment_id}","${(c.video_title || '').replace(/"/g, '""')}","${(c.comment_text || '').replace(/"/g, '""').replace(/\n/g, ' ')}","${c.author_name}","${c.published_at}",${c.like_count},${c.reply_count}`
    )
  ].join('\n');
  fs.writeFileSync(csvPath, csvContent);
  
  console.log(`\n✅ EXPORT COMPLETE!`);
  console.log(`   💬 Total comments: ${allComments.length}`);
  console.log(`   📁 JSON: ${outputPath}`);
  console.log(`   📁 CSV: ${csvPath}`);
  
  // Statistics
  const videoCounts = {};
  const authorCounts = {};
  
  allComments.forEach(c => {
    if (c.video_title) videoCounts[c.video_title] = (videoCounts[c.video_title] || 0) + 1;
    if (c.author_name) authorCounts[c.author_name] = (authorCounts[c.author_name] || 0) + 1;
  });
  
  console.log(`\n📊 STATISTICS:`);
  console.log(`   🎥 Unique videos: ${Object.keys(videoCounts).length}`);
  console.log(`   👤 Unique commenters: ${Object.keys(authorCounts).length}`);
  console.log(`   💬 Avg comment length: ${Math.round(allComments.reduce((sum, c) => sum + (c.comment_text?.length || 0), 0) / allComments.length)} chars`);
  console.log(`   👍 Total likes: ${allComments.reduce((sum, c) => sum + (c.like_count || 0), 0)}`);
  
  return allComments;
}

exportAllComments().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
