/**
 * Idea Radar API - Returns current outliers across niches
 * GET /api/idea-radar
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface OutlierVideo {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  score: number;
  domain: string;
  niche: string;
  micro: string;
  views: number;
  age_days: number;
  summary?: string;
}

interface IdeaRadarResponse {
  outliers: OutlierVideo[];
  total: number;
  hasMore: boolean;
  filters_applied: {
    time_range: string;
    min_score: number;
    domain?: string;
  };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const searchParams = request.nextUrl.searchParams;
    const timeRange = searchParams.get('timeRange') || 'week';
    const minScore = parseFloat(searchParams.get('minScore') || '3');
    const domain = searchParams.get('domain');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');
    const randomize = searchParams.get('randomize') === 'true';

    // Validate parameters
    if (minScore < 1 || minScore > 10) {
      return NextResponse.json(
        { error: 'minScore must be between 1 and 10' },
        { status: 400 }
      );
    }

    // Calculate days based on time range
    const daysMap = {
      'day': 1,
      'week': 7,
      'month': 30,
      'quarter': 90
    };
    const days = daysMap[timeRange as keyof typeof daysMap] || 7;

    // Initialize Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log(`🎯 Idea Radar: Finding outliers (${timeRange}, score>${minScore}, domain:${domain || 'all'}, randomize:${randomize})`);

    if (randomize) {
      // For randomized results, we don't need total count or pagination
      // Use ORDER BY RANDOM() to get a random sample
      let query = supabase
        .from('heistable_videos')
        .select('*')
        .gte('temporal_performance_score', minScore)
        .lte('age_days', days)
        .limit(limit);

      // Apply domain filter if specified
      if (domain) {
        query = query.eq('topic_domain', domain);
      }

      // For now, use a simple approach: get more results and randomly sample them
      // This avoids complex SQL random() issues
      const largerQuery = supabase
        .from('heistable_videos')
        .select('*')
        .gte('temporal_performance_score', minScore)
        .lte('age_days', days)
        .order('temporal_performance_score', { ascending: false })
        .limit(Math.min(limit * 5, 100)); // Get 5x more results to sample from

      if (domain) {
        largerQuery.eq('topic_domain', domain);
      }

      const { data: allVideos, error } = await largerQuery;
      
      if (error) {
        console.error('❌ Failed to fetch outliers for random sampling:', error);
        throw error;
      }

      // Randomly shuffle and take the requested amount
      const shuffledVideos = (allVideos || []).sort(() => Math.random() - 0.5).slice(0, limit);

      const outliers: OutlierVideo[] = shuffledVideos.map(v => ({
        video_id: v.video_id,
        title: v.title,
        channel_name: v.channel_name,
        thumbnail_url: v.thumbnail_url,
        score: parseFloat(v.temporal_performance_score),
        domain: v.topic_domain || 'Unknown',
        niche: v.topic_niche || 'Unknown',
        micro: v.topic_micro || '',
        views: v.view_count,
        age_days: v.age_days,
        summary: v.llm_summary
      }));

      console.log(`✅ Found ${outliers.length} random outliers (sampled from ${allVideos?.length}) in ${Date.now() - startTime}ms`);

      return NextResponse.json({
        outliers,
        total: outliers.length,
        hasMore: false, // No pagination for random results
        filters_applied: {
          time_range: timeRange,
          min_score: minScore,
          domain: domain || undefined
        }
      });

    } else {
      // Original pagination-based approach
      // First get the total count
      let countQuery = supabase
        .from('heistable_videos')
        .select('*', { count: 'exact', head: true })
        .gte('temporal_performance_score', minScore)
        .lte('age_days', days);

      if (domain) {
        countQuery = countQuery.eq('topic_domain', domain);
      }

      const { count: totalCount, error: countError } = await countQuery;
      
      if (countError) {
        console.error('❌ Failed to get count:', countError);
        throw countError;
      }

      // Adjust offset if it exceeds available rows
      const maxOffset = Math.max(0, (totalCount || 0) - limit);
      const adjustedOffset = Math.min(offset, maxOffset);

      // Query the materialized view with adjusted offset
      let query = supabase
        .from('heistable_videos')
        .select('*')
        .gte('temporal_performance_score', minScore)
        .lte('age_days', days)
        .order('temporal_performance_score', { ascending: false })
        .range(adjustedOffset, adjustedOffset + limit - 1);

      // Apply domain filter if specified
      if (domain) {
        query = query.eq('topic_domain', domain);
      }

      const { data: videos, error } = await query;

      if (error) {
        console.error('❌ Failed to fetch outliers:', error);
        throw error;
      }

      // Transform to response format
      const outliers: OutlierVideo[] = (videos || []).map(v => ({
        video_id: v.video_id,
        title: v.title,
        channel_name: v.channel_name,
        thumbnail_url: v.thumbnail_url,
        score: parseFloat(v.temporal_performance_score),
        domain: v.topic_domain || 'Unknown',
        niche: v.topic_niche || 'Unknown',
        micro: v.topic_micro || '',
        views: v.view_count,
        age_days: v.age_days,
        summary: v.llm_summary
      }));

      const hasMore = adjustedOffset + limit < (totalCount || 0);
      const processingTime = Date.now() - startTime;

      console.log(`✅ Found ${outliers.length} outliers (${totalCount} total) in ${processingTime}ms`);

      const response: IdeaRadarResponse = {
        outliers,
        total: totalCount || 0,
        hasMore,
        filters_applied: {
          time_range: timeRange,
          min_score: minScore,
          domain: domain || undefined
        }
      };

      return NextResponse.json(response);
    }
  } catch (error) {
    console.error('❌ Idea Radar failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to fetch outliers',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Get unique domains for filtering
export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();
    
    if (action === 'get-domains') {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      const { data, error } = await supabase
        .from('heistable_videos')
        .select('topic_domain')
        .not('topic_domain', 'is', null);

      if (error) throw error;

      // Get unique domains with counts
      const domainCounts = (data || []).reduce((acc: Record<string, number>, v) => {
        if (v.topic_domain) {
          acc[v.topic_domain] = (acc[v.topic_domain] || 0) + 1;
        }
        return acc;
      }, {});

      const domains = Object.entries(domainCounts)
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count);

      return NextResponse.json({ domains });
    }

    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('❌ Domain fetch failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch domains' },
      { status: 500 }
    );
  }
}