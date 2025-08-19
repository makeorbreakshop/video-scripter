#!/usr/bin/env node
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

dotenv.config();

const MAKE_OR_BREAK_SHOP_CHANNEL_ID = 'UCjWkNxpp3UHdEavpM_19--Q';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing environment variables. Check your .env file.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function exportAllQualityComments() {
  console.log('🚀 Exporting all quality comments from last 5 years...');
  
  try {
    // Use RPC to execute raw SQL
    const { data, error } = await supabase.rpc('execute_sql', {
      query: `
        SELECT 
          comment_id,
          video_id,
          video_title,
          comment_text,
          author_name,
          published_at,
          like_count,
          reply_count
        FROM youtube_comments
        WHERE channel_id = '${MAKE_OR_BREAK_SHOP_CHANNEL_ID}'
          AND published_at >= '2020-01-01'
          AND comment_text IS NOT NULL
          AND LENGTH(comment_text) > 50
          AND comment_text NOT LIKE '%http%http%http%'
          AND comment_text NOT LIKE '%BUY NOW%'
          AND comment_text NOT LIKE '%Click here%'
          AND comment_text NOT LIKE '%₹%'
          AND comment_text NOT LIKE '%$$$%'
          AND comment_text NOT LIKE '%►►►%'
          AND NOT (comment_text LIKE '%0:05%' AND comment_text LIKE '%0:30%')
          AND comment_text NOT LIKE '%youtube.com/post/%'
          AND comment_text NOT LIKE '%MyBest.Tools%'
          AND comment_text NOT LIKE '%woodplans.works%'
        ORDER BY published_at DESC
      `
    });

    if (error) {
      // Fallback to simpler query
      console.log('RPC failed, using simpler query...');
      
      const { data: comments, error: queryError } = await supabase
        .from('youtube_comments')
        .select('*')
        .eq('channel_id', MAKE_OR_BREAK_SHOP_CHANNEL_ID)
        .gte('published_at', '2020-01-01')
        .not('comment_text', 'is', null)
        .order('published_at', { ascending: false });

      if (queryError) {
        console.error('❌ Database error:', queryError);
        return;
      }

      // Filter in JavaScript
      const filteredComments = comments.filter(comment => {
        const text = comment.comment_text || '';
        if (text.length <= 50) return false;
        if (text.includes('http') && text.split('http').length > 3) return false;
        if (text.includes('BUY NOW')) return false;
        if (text.includes('Click here')) return false;
        if (text.includes('₹')) return false;
        if (text.includes('$$$')) return false;
        if (text.includes('►►►')) return false;
        if (text.includes('0:05') && text.includes('0:30')) return false;
        if (text.includes('youtube.com/post/')) return false;
        if (text.includes('MyBest.Tools')) return false;
        if (text.includes('woodplans.works')) return false;
        return true;
      });

      processComments(filteredComments);
    } else {
      processComments(data);
    }

  } catch (error) {
    console.error('❌ Export failed:', error.message);
  }
}

function processComments(allComments) {
  // Save to JSON file
  const outputPath = path.join(process.cwd(), 'docs', 'customer-avatar-all-comments.json');
  fs.writeFileSync(outputPath, JSON.stringify(allComments, null, 2));
  
  console.log(`\n✅ EXPORT COMPLETE!`);
  console.log(`   💬 Total comments exported: ${allComments.length}`);
  console.log(`   📁 Saved to: ${outputPath}`);

  // Also create a CSV for easier analysis
  const csvPath = path.join(process.cwd(), 'docs', 'customer-avatar-all-comments.csv');
  const csvContent = [
    'comment_id,video_title,comment_text,author_name,published_at,like_count,reply_count',
    ...allComments.map(c => 
      `"${c.comment_id}","${(c.video_title || '').replace(/"/g, '""')}","${(c.comment_text || '').replace(/"/g, '""').replace(/\n/g, ' ')}","${c.author_name}","${c.published_at}",${c.like_count},${c.reply_count}`
    )
  ].join('\n');
  
  fs.writeFileSync(csvPath, csvContent);
  console.log(`   📁 CSV saved to: ${csvPath}`);

  // Summary statistics
  const videoCounts = {};
  const authorCounts = {};
  
  allComments.forEach(c => {
    if (c.video_title) videoCounts[c.video_title] = (videoCounts[c.video_title] || 0) + 1;
    if (c.author_name) authorCounts[c.author_name] = (authorCounts[c.author_name] || 0) + 1;
  });

  console.log(`\n📊 STATISTICS:`);
  console.log(`   🎥 Unique videos: ${Object.keys(videoCounts).length}`);
  console.log(`   👤 Unique commenters: ${Object.keys(authorCounts).length}`);
  console.log(`   💬 Average comment length: ${Math.round(allComments.reduce((sum, c) => sum + (c.comment_text?.length || 0), 0) / allComments.length)} characters`);
  console.log(`   👍 Total likes: ${allComments.reduce((sum, c) => sum + (c.like_count || 0), 0)}`);
  console.log(`   💬 Total replies: ${allComments.reduce((sum, c) => sum + (c.reply_count || 0), 0)}`);
  
  // Top videos by comment count
  const topVideos = Object.entries(videoCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  console.log(`\n🏆 TOP VIDEOS BY ENGAGEMENT:`);
  topVideos.forEach(([title, count], i) => {
    console.log(`   ${i + 1}. ${title} (${count} comments)`);
  });
}

// Run the export
exportAllQualityComments().then(() => {
  console.log('\n✨ Export finished');
  process.exit(0);
}).catch(error => {
  console.error('💥 Export failed:', error);
  process.exit(1);
});