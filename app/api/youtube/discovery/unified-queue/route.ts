import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { searchParams } = new URL(request.url);
    const sortBy = searchParams.get('sortBy') || 'discovery_date';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const method = searchParams.get('method');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const minSubscribers = searchParams.get('minSubscribers');
    const maxSubscribers = searchParams.get('maxSubscribers');
    const minVideos = searchParams.get('minVideos');
    const maxVideos = searchParams.get('maxVideos');
    const duplicateFilter = searchParams.get('duplicateFilter');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;
    const includeSummary = searchParams.get('includeSummary') === 'true';

    // Single query that gets both data and total count
    let query = supabase
      .from('channel_discovery')
      .select(`
        id,
        discovered_channel_id,
        source_channel_id,
        discovery_method,
        discovery_date,
        discovery_context,
        channel_metadata,
        subscriber_count,
        video_count,
        relevance_score,
        validation_status,
        created_at,
        updated_at
      `, { count: 'exact' })
      .range(offset, offset + limit - 1)
      .order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false });

    // Apply filters
    if (method && method !== 'all') {
      query = query.eq('discovery_method', method);
    }

    if (status && status !== 'all') {
      query = query.eq('validation_status', status);
    }

    // Server-side text search with better performance
    if (search && search.trim()) {
      query = query.or(`channel_metadata->>title.ilike.%${search.trim()}%,discovered_channel_id.ilike.%${search.trim()}%`);
    }

    // Server-side range filters
    if (minSubscribers && !isNaN(parseInt(minSubscribers))) {
      query = query.gte('subscriber_count', parseInt(minSubscribers));
    }
    if (maxSubscribers && !isNaN(parseInt(maxSubscribers))) {
      query = query.lte('subscriber_count', parseInt(maxSubscribers));
    }
    if (minVideos && !isNaN(parseInt(minVideos))) {
      query = query.gte('video_count', parseInt(minVideos));
    }
    if (maxVideos && !isNaN(parseInt(maxVideos))) {
      query = query.lte('video_count', parseInt(maxVideos));
    }

    const { data: channels, error, count: totalCount } = await query;

    if (error) {
      console.error('Unified queue error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch channels', details: error.message },
        { status: 500 }
      );
    }

    // Only calculate summary stats if specifically requested and use efficient aggregation
    let summary = null;
    if (includeSummary) {
      // Use a more efficient aggregation query for summary stats
      const { data: summaryData } = await supabase
        .from('channel_discovery')
        .select('validation_status, discovery_method', { count: 'exact' });

      if (summaryData) {
        const statusCounts = { pending: 0, approved: 0, rejected: 0, imported: 0, total: summaryData.length };
        const methodCounts: Record<string, number> = {};

        summaryData.forEach((row) => {
          const status = row.validation_status;
          const method = row.discovery_method;

          if (status && statusCounts.hasOwnProperty(status)) {
            statusCounts[status as keyof typeof statusCounts]++;
          }

          if (method) {
            methodCounts[method] = (methodCounts[method] || 0) + 1;
          }
        });

        summary = {
          ...statusCounts,
          byMethod: methodCounts
        };
      }
    }

    return NextResponse.json({
      success: true,
      channels: channels || [],
      summary,
      pagination: {
        page,
        limit,
        total: totalCount || 0,
        totalPages: Math.ceil((totalCount || 0) / limit)
      },
      filters: {
        sortBy,
        sortOrder,
        method,
        status,
        search,
        minSubscribers,
        maxSubscribers,
        minVideos,
        maxVideos,
        duplicateFilter
      }
    });

  } catch (error) {
    console.error('Unified queue error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch unified queue' },
      { status: 500 }
    );
  }
}