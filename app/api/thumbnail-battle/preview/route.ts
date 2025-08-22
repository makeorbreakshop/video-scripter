import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Format subscriber count as ballpark figure (same as main endpoint)
function getBallparkSubs(count: number): number {
  if (!count) return 0;
  
  if (count < 1000) return Math.round(count / 100) * 100;
  if (count < 10000) return Math.round(count / 1000) * 1000;
  if (count < 50000) return Math.round(count / 5000) * 5000;
  if (count < 100000) return Math.round(count / 10000) * 10000;
  if (count < 500000) return Math.round(count / 50000) * 50000;
  if (count < 1000000) return Math.round(count / 100000) * 100000;
  return Math.round(count / 1000000) * 1000000;
}

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    
    // Try to get a random matchup from the materialized view
    // This should be INSTANT since it's pre-computed
    const { data: matchup, error } = await supabase
      .from('thumbnail_battle_matchup_pool')
      .select('*')
      .order('random_sort', { ascending: true })
      .limit(1)
      .single();

    if (error || !matchup) {
      // Fallback to a simple query if materialized view doesn't exist
      console.log('Materialized view not available, using fallback');
      
      // Just get 2 random videos from big channels for preview
      const { data: videos, error: fallbackError } = await supabase
        .from('videos')
        .select(`
          id,
          title,
          thumbnail_url,
          channel_id,
          view_count,
          channels!inner(
            channel_name,
            subscriber_count,
            thumbnail_url
          )
        `)
        .not('thumbnail_url', 'is', null)
        .gte('channels.subscriber_count', 100000)
        .limit(2);

      if (fallbackError || !videos || videos.length < 2) {
        return NextResponse.json({ error: 'No preview available' }, { status: 500 });
      }

      // Format as simple preview
      return NextResponse.json({
        preview: true,
        videoA: {
          thumbnail_url: videos[0].thumbnail_url,
          title: videos[0].title
        },
        videoB: {
          thumbnail_url: videos[1].thumbnail_url,
          title: videos[1].title
        }
      });
    }

    // Format the response from materialized view
    // Randomly assign A/B positions for variety
    const randomOrder = Math.random() > 0.5;
    
    const channelInfo = {
      channel_title: matchup.channel_name,
      channel_avatar: matchup.channel_avatar,
      channel_subscriber_count: getBallparkSubs(matchup.subscriber_count)
    };

    const highPerformer = {
      id: matchup.high_performer_id,
      title: matchup.high_performer_title,
      thumbnail_url: matchup.high_performer_thumbnail,
      view_count: matchup.high_performer_views,
      ...channelInfo
    };

    const lowPerformer = {
      id: matchup.low_performer_id,
      title: matchup.low_performer_title,
      thumbnail_url: matchup.low_performer_thumbnail,
      view_count: matchup.low_performer_views,
      ...channelInfo
    };

    return NextResponse.json({
      preview: true,
      channel: channelInfo,
      videoA: randomOrder ? highPerformer : lowPerformer,
      videoB: randomOrder ? lowPerformer : highPerformer
    });

  } catch (error) {
    console.error('Error getting preview:', error);
    return NextResponse.json(
      { error: 'Failed to get preview' },
      { status: 500 }
    );
  }
}