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
    min_views: number;
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
    const minViews = parseInt(searchParams.get('minViews') || '100000');

    // Validate parameters
    if (minScore < 1 || minScore > 100) {
      return NextResponse.json(
        { error: 'minScore must be between 1 and 100' },
        { status: 400 }
      );
    }

    // Validate minViews (must be one of the allowed values)
    const allowedViews = [100, 1000, 10000, 100000, 1000000, 10000000];
    if (!allowedViews.includes(minViews)) {
      return NextResponse.json(
        { error: 'minViews must be one of: 100, 1000, 10000, 100000, 1000000, 10000000' },
        { status: 400 }
      );
    }

    // Calculate days based on time range
    const daysMap = {
      'day': 1,
      'week': 7,
      'month': 30,
      'quarter': 90,
      'halfyear': 180,
      'year': 365,
      'twoyears': 730
    };
    const days = daysMap[timeRange as keyof typeof daysMap] || 7;

    // Initialize Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log(`🎯 Idea Radar: Finding outliers (${timeRange}, score>${minScore}, views>${minViews}, domain:${domain || 'all'}, randomize:${randomize})`);

    // Always use videos table directly with optimized indexes (faster than materialized view)
    const useDirectTable = true;
    const tableName = 'videos';
    console.log(`Using ${tableName} table (days: ${days})`);
    
    if (randomize) {
      // Use RPC function for true random ordering with consistent pagination
      // Get or create a session seed from the request
      const sessionSeed = searchParams.get('seed');
      const seedValue = sessionSeed ? parseFloat(sessionSeed) : Math.random();
      
      console.log(`🎲 Using RPC function with seed: ${seedValue}, offset: ${offset}`);
      
      // Call the RPC function for random video fetching
      const { data: shuffledVideos, error } = await supabase.rpc('get_random_outlier_videos', {
        seed_value: seedValue,
        min_score: minScore,
        days_back: days,
        min_views: minViews,
        domain_filter: domain || null,
        page_limit: limit,
        page_offset: offset
      });
      
      if (error) {
        console.error('❌ Failed to fetch random videos via RPC:', error);
        throw error;
      }

      const outliers: OutlierVideo[] = shuffledVideos.map(v => ({
        video_id: v.id,
        title: v.title,
        channel_name: v.channel_name,
        thumbnail_url: v.thumbnail_url,
        score: parseFloat(v.temporal_performance_score),
        domain: v.topic_domain || 'Unknown',
        niche: v.topic_niche || 'Unknown',
        micro: v.topic_micro || '',
        views: v.view_count,
        age_days: Math.floor((Date.now() - new Date(v.published_at).getTime()) / (1000 * 60 * 60 * 24)),
        summary: v.llm_summary
      }));

      console.log(`✅ Found ${outliers.length} random outliers via RPC in ${Date.now() - startTime}ms`);

      return NextResponse.json({
        outliers,
        total: outliers.length, // Actual count from RPC
        hasMore: true, // Always show more for random results to encourage exploration
        seed: seedValue, // Return the seed for frontend to maintain consistency
        filters_applied: {
          time_range: timeRange,
          min_score: minScore,
          min_views: minViews,
          domain: domain || undefined
        }
      });

    } else {
      // Original pagination-based approach
      // First get the total count
      let countQuery = supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .gte('temporal_performance_score', minScore)
        .lte('temporal_performance_score', 100) // Cap at 100x
        .gte('published_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
        .eq('is_short', false)
        .eq('is_institutional', false) // Filter out institutional content
        .gte('view_count', minViews); // Use new minViews parameter

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

      // Query with adjusted offset
      let query = supabase
        .from('videos')
        .select('id, title, channel_name, channel_id, thumbnail_url, view_count, temporal_performance_score, topic_domain, topic_niche, topic_micro, llm_summary, published_at')
        .gte('temporal_performance_score', minScore)
        .lte('temporal_performance_score', 100) // Cap at 100x
        .gte('published_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
        .eq('is_short', false)
        .eq('is_institutional', false) // Filter out institutional content
        .gte('view_count', minViews) // Use new minViews parameter
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
        video_id: v.id,
        title: v.title,
        channel_name: v.channel_name,
        thumbnail_url: v.thumbnail_url,
        score: parseFloat(v.temporal_performance_score),
        domain: v.topic_domain || 'Unknown',
        niche: v.topic_niche || 'Unknown',
        micro: v.topic_micro || '',
        views: v.view_count,
        age_days: Math.floor((Date.now() - new Date(v.published_at).getTime()) / (1000 * 60 * 60 * 24)),
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
          min_views: minViews,
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
        .from('videos')
        .select('topic_domain')
        .not('topic_domain', 'is', null)
        .gte('temporal_performance_score', 1.5)
        .lte('temporal_performance_score', 100) // Cap at 100x
        .eq('is_short', false)
        .eq('is_institutional', false) // Filter out institutional content
        .gte('view_count', 100000) // Keep default for domain list
        .gte('published_at', new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString()); // 2 years

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