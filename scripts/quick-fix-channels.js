import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

async function quickFix() {
  try {
    // Get the specific channels that need fixing from the materialized view
    const { data: channels, error } = await supabase
      .from('competitor_channel_summary')
      .select('channel_id')
      .eq('subscriber_count', 0);
    
    if (error || !channels) {
      console.error('Error getting channels:', error);
      return;
    }
    
    console.log(`Found ${channels.length} channels to fix`);
    
    // Process all channels in one API call (YouTube supports up to 50)
    const channelIds = channels.map(c => c.channel_id).filter(id => id && id.length > 0).join(',');
    
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?` +
      `part=snippet,statistics` +
      `&id=${channelIds}` +
      `&key=${YOUTUBE_API_KEY}`
    );
    
    const data = await response.json();
    console.log(`YouTube API returned ${data.items?.length || 0} channels`);
    
    // Update each channel
    for (const channel of data.items || []) {
      const channelStats = {
        subscriber_count: channel.statistics?.subscriberCount || '0',
        view_count: channel.statistics?.viewCount || '0', 
        video_count: channel.statistics?.videoCount || '0',
        channel_thumbnail: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.default?.url || null,
      };
      
      // Update using raw SQL for efficiency
      const { error: updateError } = await supabase.rpc('execute_sql', {
        query: `
          UPDATE videos 
          SET metadata = jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  metadata,
                  '{channel_name}', $1::jsonb
                ),
                '{channel_title}', $1::jsonb
              ),
              '{channel_handle}', $2::jsonb
            ),
            '{channel_stats}', $3::jsonb
          )
          WHERE channel_id = $4 AND is_competitor = true
        `,
        params: [
          JSON.stringify(channel.snippet?.title || ''),
          JSON.stringify(channel.snippet?.customUrl || ''),
          JSON.stringify(channelStats),
          channel.id
        ]
      });
      
      if (updateError) {
        // Fallback to standard update
        const { data: videos } = await supabase
          .from('videos')
          .select('id, metadata')
          .eq('channel_id', channel.id)
          .eq('is_competitor', true)
          .limit(50); // Update first 50 videos only
        
        for (const video of videos || []) {
          await supabase
            .from('videos')
            .update({
              metadata: {
                ...video.metadata,
                channel_name: channel.snippet?.title,
                channel_title: channel.snippet?.title,
                channel_handle: channel.snippet?.customUrl,
                channel_stats: channelStats
              }
            })
            .eq('id', video.id);
        }
      }
      
      console.log(`✅ Updated ${channel.snippet?.title} (${channelStats.subscriber_count} subscribers)`);
    }
    
    console.log('\n🔄 Refreshing materialized view...');
    await supabase.rpc('refresh_competitor_channel_summary');
    console.log('✅ Done!');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

quickFix();