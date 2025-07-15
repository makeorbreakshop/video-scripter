import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  console.log('📋 Pattern List API called');
  
  try {
    const { searchParams } = new URL(request.url);
    const pattern_type = searchParams.get('type');
    const topic_cluster = searchParams.get('topic_cluster');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    console.log('Pattern list request:', {
      pattern_type,
      topic_cluster,
      limit,
      offset
    });

    let query = supabase
      .from('patterns')
      .select(`
        id,
        pattern_type,
        pattern_data,
        performance_stats,
        created_at,
        updated_at
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (pattern_type) {
      query = query.eq('pattern_type', pattern_type);
    }

    if (topic_cluster) {
      query = query.contains('pattern_data', { context: topic_cluster });
    }

    const { data: patterns, error } = await query;

    if (error) {
      console.error('Error fetching patterns:', error);
      return NextResponse.json(
        { error: 'Failed to fetch patterns' },
        { status: 500 }
      );
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('patterns')
      .select('*', { count: 'exact', head: true });

    if (pattern_type) {
      countQuery = countQuery.eq('pattern_type', pattern_type);
    }

    if (topic_cluster) {
      countQuery = countQuery.contains('pattern_data', { context: topic_cluster });
    }

    const { count } = await countQuery;

    // Enrich patterns with example videos
    const enrichedPatterns = await Promise.all(
      (patterns || []).map(async (pattern) => {
        // Get example videos for this pattern
        const { data: videoPatterns } = await supabase
          .from('video_patterns')
          .select(`
            video_id,
            match_score,
            videos (
              id,
              title,
              channel_name,
              view_count,
              published_at,
              thumbnail_url
            )
          `)
          .eq('pattern_id', pattern.id)
          .order('match_score', { ascending: false })
          .limit(3);

        return {
          ...pattern,
          example_videos: videoPatterns?.map(vp => ({
            ...vp.videos,
            match_score: vp.match_score
          })) || []
        };
      })
    );

    return NextResponse.json({
      success: true,
      patterns: enrichedPatterns,
      pagination: {
        total: count || 0,
        limit,
        offset,
        has_more: (count || 0) > offset + limit
      }
    });

  } catch (error) {
    console.error('Pattern list error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch patterns',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}