#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function quickChapterScan() {
  console.log('🔍 Quick Chapter Scan (10K sample)\n');
  
  // Get a diverse sample
  const { data: videos } = await supabase
    .from('videos')
    .select('id, title, description, channel_name, view_count')
    .not('description', 'is', null)
    .gte('view_count', 10000) // Focus on popular videos
    .order('view_count', { ascending: false })
    .limit(10000);
  
  let videosWithChapters = 0;
  const examples = [];
  
  for (const video of videos || []) {
    // Quick check for 0:00 or 00:00 pattern
    if (video.description && /^(0:00|00:00)\s+/m.test(video.description)) {
      // Count timestamp lines
      const timestampMatches = video.description.match(/^\d{1,2}:\d{2}(?::\d{2})?\s+.+$/gm);
      
      if (timestampMatches && timestampMatches.length >= 2) {
        videosWithChapters++;
        
        if (examples.length < 5) {
          examples.push({
            title: video.title,
            channel: video.channel_name,
            views: video.view_count,
            chapterCount: timestampMatches.length,
            firstChapters: timestampMatches.slice(0, 3)
          });
        }
      }
    }
  }
  
  const percentage = ((videosWithChapters / videos.length) * 100).toFixed(2);
  
  console.log(`✅ Results from ${videos.length.toLocaleString()} popular videos:`);
  console.log(`- Videos with chapters: ${videosWithChapters} (${percentage}%)`);
  console.log(`- Estimated total with chapters: ${Math.round(176479 * videosWithChapters / videos.length).toLocaleString()}`);
  
  console.log('\n📝 Examples:');
  examples.forEach((ex, i) => {
    console.log(`\n${i+1}. ${ex.title}`);
    console.log(`   Channel: ${ex.channel}`);
    console.log(`   ${ex.chapterCount} chapters, first few:`);
    ex.firstChapters.forEach(ch => console.log(`   ${ch}`));
  });
}

quickChapterScan().catch(console.error);