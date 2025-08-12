import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sortBy = searchParams.get('sortBy') || 'discovery_date';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const method = searchParams.get('method');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '100');

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
      `)
      .order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false })
      .limit(limit);

    // Apply filters
    if (method && method !== 'all') {
      query = query.eq('discovery_method', method);
    }

    if (status && status !== 'all') {
      query = query.eq('validation_status', status);
    }

    const { data: channels, error } = await query;

    if (error) {
      console.error('Unified queue error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch channels', details: error.message },
        { status: 500 }
      );
    }

    // Calculate summary stats
    const allChannelsQuery = await supabase
      .from('channel_discovery')
      .select('validation_status, discovery_method')
      .not('validation_status', 'is', null);

    const allChannels = allChannelsQuery.data || [];
    const summary = {
      total: allChannels.length,
      pending: allChannels.filter(ch => ch.validation_status === 'pending').length,
      approved: allChannels.filter(ch => ch.validation_status === 'approved').length,
      rejected: allChannels.filter(ch => ch.validation_status === 'rejected').length,
      imported: allChannels.filter(ch => ch.validation_status === 'imported').length,
      byMethod: allChannels.reduce((acc, ch) => {
        acc[ch.discovery_method] = (acc[ch.discovery_method] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    };

    return NextResponse.json({
      success: true,
      channels: channels || [],
      summary,
      filters: {
        sortBy,
        sortOrder,
        method,
        status,
        limit
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