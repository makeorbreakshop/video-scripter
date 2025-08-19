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
  
  const batchSize = 1000;
  let offset = 0;
  let allComments = [];
  let hasMore = true;

  try {
    while (hasMore) {
      console.log(`📥 Fetching batch at offset ${offset}...`);
      
      const { data, error } = await supabase
        .from('youtube_comments')
        .select('comment_id, video_id, video_title, comment_text, author_name, published_at, like_count, reply_count')
        .eq('channel_id', MAKE_OR_BREAK_SHOP_CHANNEL_ID)
        .gte('published_at', '2020-01-01')
        .not('comment_text', 'is', null)
        .gte('length(comment_text)', 50)
        .order('published_at', { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (error) {
        console.error('❌ Database error:', error);
        break;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      // Filter out spam in JavaScript
      const filteredData = data.filter(comment => {
        const text = comment.comment_text;
        // Filter spam patterns
        if (text.includes('http') && text.includes('http') && text.includes('http')) return false;
        if (text.includes('BUY NOW')) return false;
        if (text.includes('Click here')) return false;
        if (text.includes('₹')) return false;
        if (text.includes('$$$')) return false;
        if (text.includes('►►►')) return false;
        if (text.includes('0:05') && text.includes('0:30')) return false;
        if (text.includes('youtube.com/post/')) return false; // Filter promotional posts
        if (text.includes('MyBest.Tools')) return false; // Filter tool spam
        if (text.includes('woodplans.works')) return false; // Filter spam sites
        return true;
      });

      allComments.push(...filteredData);
      console.log(`   ✓ Fetched ${data.length} comments, kept ${filteredData.length} after filtering (Total: ${allComments.length})`);
      
      offset += batchSize;
      if (data.length < batchSize) {
        hasMore = false;
      }
    }

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
        `"${c.comment_id}","${c.video_title?.replace(/"/g, '""')}","${c.comment_text?.replace(/"/g, '""')}","${c.author_name}","${c.published_at}",${c.like_count},${c.reply_count}`
      )
    ].join('\n');
    
    fs.writeFileSync(csvPath, csvContent);
    console.log(`   📁 CSV saved to: ${csvPath}`);

    // Summary statistics
    const videoCounts = {};
    const authorCounts = {};
    
    allComments.forEach(c => {
      videoCounts[c.video_title] = (videoCounts[c.video_title] || 0) + 1;
      authorCounts[c.author_name] = (authorCounts[c.author_name] || 0) + 1;
    });

    console.log(`\n📊 STATISTICS:`);
    console.log(`   🎥 Unique videos: ${Object.keys(videoCounts).length}`);
    console.log(`   👤 Unique commenters: ${Object.keys(authorCounts).length}`);
    console.log(`   💬 Average comment length: ${Math.round(allComments.reduce((sum, c) => sum + c.comment_text.length, 0) / allComments.length)} characters`);
    console.log(`   👍 Total likes: ${allComments.reduce((sum, c) => sum + c.like_count, 0)}`);
    console.log(`   💬 Total replies: ${allComments.reduce((sum, c) => sum + c.reply_count, 0)}`);

  } catch (error) {
    console.error('❌ Export failed:', error.message);
  }
}

// Run the export
exportAllQualityComments().then(() => {
  console.log('✨ Export finished');
  process.exit(0);
}).catch(error => {
  console.error('💥 Export failed:', error);
  process.exit(1);
});