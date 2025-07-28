import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function getTopVideos() {
  try {
    const { data, error } = await supabase
      .from('videos')
      .select('id, title, view_count')
      .not('id', 'is', null)
      .order('view_count', { ascending: false })
      .limit(5);

    if (error) {
      console.error('Error fetching videos:', error);
      return;
    }

    console.log('Top 5 videos by view count:');
    console.log('===========================');
    
    data.forEach((video, index) => {
      const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
      console.log(`\n${index + 1}. ${video.title}`);
      console.log(`   Views: ${video.view_count?.toLocaleString() || 'N/A'}`);
      console.log(`   URL: ${videoUrl}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

getTopVideos();