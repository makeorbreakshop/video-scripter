import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function findWittWoodworksVideos() {
  console.log('Finding videos from Witt Woodworks channel...\n');

  try {
    // First, find channels that match "Witt Woodworks"
    const { data: channels, error: channelError } = await supabase
      .from('videos')
      .select('channel_id, channel_title')
      .or('channel_id.ilike.%witt%,channel_title.ilike.%Witt Woodworks%')
      .limit(5);

    if (channelError) {
      console.error('Error finding channels:', channelError);
      return;
    }

    // Get unique channel IDs
    const uniqueChannels = [...new Set(channels.map(c => c.channel_id))];
    console.log('Found channels:', uniqueChannels);

    if (uniqueChannels.length === 0) {
      console.log('No channels found matching "Witt Woodworks"');
      return;
    }

    // Get top 10 videos from these channels by view count
    const { data: videos, error: videosError } = await supabase
      .from('videos')
      .select('id, title, view_count, channel_id, channel_title, published_at')
      .in('channel_id', uniqueChannels)
      .order('view_count', { ascending: false })
      .limit(10);

    if (videosError) {
      console.error('Error fetching videos:', videosError);
      return;
    }

    // Display results
    console.log(`\nTop ${videos.length} videos from Witt Woodworks channel(s):\n`);
    videos.forEach((video, index) => {
      console.log(`${index + 1}. ${video.title}`);
      console.log(`   Views: ${video.view_count?.toLocaleString() || 'N/A'}`);
      console.log(`   Channel: ${video.channel_title || video.channel_id}`);
      console.log(`   Published: ${video.published_at ? new Date(video.published_at).toLocaleDateString() : 'N/A'}`);
      console.log(`   Video ID: ${video.id}`);
      console.log('');
    });

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the function
findWittWoodworksVideos();