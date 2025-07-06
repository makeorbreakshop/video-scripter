import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sortBy = searchParams.get('sortBy') || 'subscriber_count'; // subscriber_count, discovery_count, video_count
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const minSubscribers = parseInt(searchParams.get('minSubscribers') || '0');
    const minVideos = parseInt(searchParams.get('minVideos') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Get pending discoveries with frequency count
    const { data: discoveries, error } = await supabase.rpc('get_discovery_review_queue', {
      min_subscribers: minSubscribers,
      min_videos: minVideos,
      sort_by: sortBy,
      sort_order: sortOrder,
      limit_count: limit
    });

    if (error) {
      console.error('Review queue error:', error);
      
      // Get existing channel names from videos table
      const { data: existingChannels } = await supabase
        .from('videos')
        .select('channel_id')
        .neq('channel_id', null);
      
      const existingChannelNames = new Set(
        existingChannels?.map(c => c.channel_id.toLowerCase()) || []
      );

      // Fallback to direct query if RPC doesn't exist
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('channel_discovery')
        .select(`
          discovered_channel_id,
          subscriber_count,
          video_count,
          discovery_date,
          discovery_method,
          channel_metadata
        `)
        .eq('validation_status', 'pending')
        .gte('subscriber_count', minSubscribers)
        .gte('video_count', minVideos)
        .order(sortBy, { ascending: sortOrder === 'asc' })
        .limit(limit * 2); // Get more to account for filtering

      if (fallbackError) {
        throw fallbackError;
      }

      // Group by channel and calculate frequency, filtering out existing channels
      const channelGroups = fallbackData.reduce((acc, discovery) => {
        const channelId = discovery.discovered_channel_id;
        const channelTitle = discovery.channel_metadata?.title || 'Unknown Channel';
        
        // Skip if this channel already exists in our videos table (by name)
        if (existingChannelNames.has(channelTitle.toLowerCase())) {
          return acc;
        }
        
        if (!acc[channelId]) {
          acc[channelId] = {
            discovered_channel_id: channelId,
            channel_title: channelTitle,
            subscriber_count: discovery.subscriber_count,
            video_count: discovery.video_count,
            discovery_count: 0,
            discovery_methods: new Set(),
            first_discovery: discovery.discovery_date,
            relevance_score: 0
          };
        }
        acc[channelId].discovery_count++;
        acc[channelId].discovery_methods.add(discovery.discovery_method);
        return acc;
      }, {});

      const reviewQueue = Object.values(channelGroups).map((channel: any) => ({
        ...channel,
        discovery_methods: Array.from(channel.discovery_methods).join(', '),
        relevance_score: calculateRelevanceScore(channel)
      }));

      return NextResponse.json({
        success: true,
        channels: reviewQueue,
        totalPending: reviewQueue.length,
        filters: {
          sortBy,
          sortOrder,
          minSubscribers,
          minVideos,
          limit
        }
      });
    }

    // Calculate relevance scores
    const enhancedDiscoveries = discoveries.map((channel: any) => ({
      ...channel,
      relevance_score: calculateRelevanceScore(channel)
    }));

    return NextResponse.json({
      success: true,
      channels: enhancedDiscoveries,
      totalPending: enhancedDiscoveries.length,
      filters: {
        sortBy,
        sortOrder,
        minSubscribers,
        minVideos,
        limit
      }
    });

  } catch (error) {
    console.error('Review queue error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch review queue' },
      { status: 500 }
    );
  }
}

function calculateRelevanceScore(channel: any): number {
  let score = 0;
  
  // Discovery frequency (most important factor)
  score += (channel.discovery_count || 1) * 20;
  
  // Subscriber count tiers
  const subs = channel.subscriber_count || 0;
  if (subs >= 1000000) score += 15;
  else if (subs >= 100000) score += 10;
  else if (subs >= 10000) score += 6;
  else if (subs >= 1000) score += 3;
  
  // Video count (content activity)
  const videos = channel.video_count || 0;
  if (videos >= 100) score += 5;
  else if (videos >= 50) score += 3;
  else if (videos >= 10) score += 2;
  
  return score;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { channelId, action, reason } = body; // action: 'approve' | 'reject'

    if (!channelId || !action) {
      return NextResponse.json(
        { error: 'channelId and action are required' },
        { status: 400 }
      );
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    
    const { data, error } = await supabase
      .from('channel_discovery')
      .update({ 
        validation_status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('discovered_channel_id', channelId)
      .eq('validation_status', 'pending')
      .select('id, discovered_channel_id, channel_metadata');

    if (error) {
      throw error;
    }

    // Log the approval action
    if (action === 'approve' && data && data.length > 0) {
      const channelTitle = data[0].channel_metadata?.title || 'Unknown Channel';
      console.log(`✅ Approved channel for import: ${channelTitle} (${channelId})`);
    }

    return NextResponse.json({
      success: true,
      action,
      channelId,
      updatedRecords: data?.length || 0,
      message: action === 'approve' ? 'Channel approved and ready for import' : 'Channel rejected'
    });

  } catch (error) {
    console.error('Review action error:', error);
    return NextResponse.json(
      { error: 'Failed to update channel status' },
      { status: 500 }
    );
  }
}