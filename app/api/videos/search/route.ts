import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const requestedLimit = Number.parseInt(searchParams.get('limit') || '20', 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 20;
    const normalizedQuery = query.trim().toLowerCase();
    const candidateLimit = normalizedQuery ? 500 : limit;
    
    const { data: candidates, error } = await supabase
      .from('videos')
      .select(`
        id,
        title,
        channel_id,
        channel_name,
        published_at,
        format_type,
        topic_cluster_id,
        topic_domain
      `)
      .not('channel_name', 'is', null)
      .not('format_type', 'is', null)
      .not('topic_cluster_id', 'is', null)
      .order('id', { ascending: true })
      .limit(candidateLimit);

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch videos' },
        { status: 500 }
      );
    }

    // Keep arbitrary ILIKE input away from the full corpus. The bounded,
    // primary-key-ordered candidate query stays below PostgREST's timeout.
    const videos = (candidates || [])
      .filter(video => !normalizedQuery ||
        video.title?.toLowerCase().includes(normalizedQuery) ||
        video.channel_name?.toLowerCase().includes(normalizedQuery))
      .sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''))
      .slice(0, limit);

    const selectedIds = videos.map(video => video.id);
    const { data: metadataRows, error: metadataError } = selectedIds.length
      ? await supabase.from('videos').select('id, metadata').in('id', selectedIds)
      : { data: [], error: null };

    if (metadataError) {
      console.error('Metadata lookup error:', metadataError);
    }

    const metadataById = new Map(
      (metadataRows || []).map(row => [row.id, row.metadata])
    );

    // Process videos to extract channel data
    const processedVideos = videos?.map(video => {
      let subscriberCount = null;
      
      // Try to extract subscriber count from metadata
      try {
        const videoMetadata = metadataById.get(video.id);
        if (videoMetadata && typeof videoMetadata === 'object') {
          const metadata = videoMetadata as any;
          if (metadata.channel_stats && metadata.channel_stats.subscriber_count) {
            subscriberCount = parseInt(metadata.channel_stats.subscriber_count);
          }
        }
      } catch (e) {
        // Ignore metadata parsing errors
      }

      return {
        id: video.id,
        title: video.title,
        channel_id: video.channel_id,
        channel_name: video.channel_name,
        published_at: video.published_at,
        format_type: video.format_type,
        topic_cluster_id: video.topic_cluster_id,
        topic_domain: video.topic_domain,
        subscriber_count: subscriberCount,
        title_word_count: video.title ? video.title.split(' ').length : 0
      };
    }) || [];

    return NextResponse.json({
      success: true,
      videos: processedVideos,
      total: processedVideos.length
    });
    
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Get channel summary for a specific channel
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { channel_id } = await request.json();
    
    if (!channel_id) {
      return NextResponse.json(
        { error: 'Missing channel_id' },
        { status: 400 }
      );
    }

    // Get channel statistics
    const { data: channelVideos, error } = await supabase
      .from('videos')
      .select(`
        title,
        format_type,
        topic_cluster_id,
        metadata
      `)
      .eq('channel_id', channel_id)
      .not('format_type', 'is', null)
      .not('topic_cluster_id', 'is', null)
      .limit(100); // Sample of recent videos

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch channel data' },
        { status: 500 }
      );
    }

    if (!channelVideos || channelVideos.length === 0) {
      return NextResponse.json(
        { error: 'No videos found for this channel' },
        { status: 404 }
      );
    }

    // Calculate channel characteristics
    const titleLengths = channelVideos
      .map(v => v.title ? v.title.split(' ').length : 0)
      .filter(len => len > 0);
    
    const avgTitleLength = titleLengths.length > 0 
      ? titleLengths.reduce((a, b) => a + b, 0) / titleLengths.length 
      : 8;

    // Get most common format and topic
    const formatCounts: { [key: string]: number } = {};
    const topicCounts: { [key: string]: number } = {};
    
    channelVideos.forEach(video => {
      if (video.format_type) {
        formatCounts[video.format_type] = (formatCounts[video.format_type] || 0) + 1;
      }
      if (video.topic_cluster_id !== null) {
        topicCounts[video.topic_cluster_id] = (topicCounts[video.topic_cluster_id] || 0) + 1;
      }
    });

    const dominantFormat = Object.entries(formatCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || 'tutorial';
      
    const dominantTopicCluster = Object.entries(topicCounts)
      .sort(([,a], [,b]) => b - a)[0]?.[0] || '50';

    // Try to get subscriber count from latest video
    let subscriberCount = 100000; // Default
    for (const video of channelVideos) {
      try {
        if (video.metadata && typeof video.metadata === 'object') {
          const metadata = video.metadata as any;
          if (metadata.channel_stats && metadata.channel_stats.subscriber_count) {
            subscriberCount = parseInt(metadata.channel_stats.subscriber_count);
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    return NextResponse.json({
      success: true,
      channel_data: {
        channel_id,
        subscriber_count: subscriberCount,
        dominant_format: dominantFormat,
        dominant_topic_cluster: parseInt(dominantTopicCluster),
        avg_title_length: Math.round(avgTitleLength * 10) / 10,
        video_count: channelVideos.length
      }
    });
    
  } catch (error) {
    console.error('Channel data error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
