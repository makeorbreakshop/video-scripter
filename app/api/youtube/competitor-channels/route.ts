import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service role to bypass RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export async function GET() {
  try {
    // Use a raw SQL query with the Supabase SQL editor endpoint
    const query = `
      WITH channel_aggregates AS (
        SELECT 
          v.channel_id,
          COUNT(*) as video_count,
          MAX(v.import_date) as last_import,
          (ARRAY_AGG(
            v.metadata ORDER BY 
            CASE 
              WHEN v.metadata->'channel_stats' IS NOT NULL THEN 0
              ELSE 1
            END,
            v.import_date DESC
          ))[1] as best_metadata
        FROM videos v
        WHERE v.is_competitor = true
        GROUP BY v.channel_id
      )
      SELECT
        ca.channel_id,
        COALESCE(ca.best_metadata->>'youtube_channel_id', ca.channel_id) as youtube_channel_id,
        COALESCE(ca.best_metadata->>'channel_name', ca.best_metadata->>'channel_title', ca.channel_id) as channel_name,
        ca.best_metadata->>'channel_title' as channel_title,
        ca.best_metadata->>'channel_handle' as channel_handle,
        (ca.best_metadata->'channel_stats'->'subscriber_count')::text::integer as subscriber_count,
        ca.video_count::integer as video_count,
        ca.last_import,
        ca.best_metadata->'channel_stats'->>'channel_thumbnail' as channel_thumbnail
      FROM channel_aggregates ca
      ORDER BY ca.video_count DESC;
    `;

    // Execute raw SQL using Supabase's SQL REST API
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/sql`, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query })
    });

    if (!response.ok) {
      // Fallback: Create a materialized view approach
      const { data: channelData, error } = await supabaseAdmin
        .from('competitor_channel_summary')
        .select('*')
        .order('video_count', { ascending: false });

      if (error || !channelData) {
        // Last resort: Use the function but with explicit casting
        const { data: funcData, error: funcError } = await supabaseAdmin.rpc('get_competitor_channel_stats');
        
        if (funcError || !funcData) {
          throw new Error('All methods failed to get channel data');
        }

        const channels = funcData.map((stat: any) => ({
          id: stat.youtube_channel_id || stat.channel_id,
          name: stat.channel_name || stat.channel_title || stat.channel_id,
          handle: stat.channel_handle || `@${stat.channel_id.replace(/\s+/g, '').toLowerCase()}`,
          subscriberCount: Number(stat.subscriber_count) || 0,
          videoCount: Number(stat.video_count) || 0,
          lastImport: stat.last_import,
          status: 'active',
          thumbnailUrl: stat.channel_thumbnail
        }));

        return NextResponse.json({ channels });
      }

      const channels = channelData.map((channel: any) => ({
        id: channel.youtube_channel_id || channel.channel_id,
        name: channel.channel_name || channel.channel_id,
        handle: channel.channel_handle || `@${channel.channel_id.replace(/\s+/g, '').toLowerCase()}`,
        subscriberCount: channel.subscriber_count || 0,
        videoCount: channel.video_count || 0,
        lastImport: channel.last_import,
        status: 'active',
        thumbnailUrl: channel.channel_thumbnail
      }));

      return NextResponse.json({ channels });
    }

    const result = await response.json();
    
    const channels = result.map((row: any) => ({
      id: row.youtube_channel_id || row.channel_id,
      name: row.channel_name || row.channel_id,
      handle: row.channel_handle || `@${row.channel_id.replace(/\s+/g, '').toLowerCase()}`,
      subscriberCount: Number(row.subscriber_count) || 0,
      videoCount: Number(row.video_count) || 0,
      lastImport: row.last_import,
      status: 'active',
      thumbnailUrl: row.channel_thumbnail
    }));

    return NextResponse.json({ channels });
  } catch (error) {
    console.error('Error loading competitor channels:', error);
    return NextResponse.json(
      { error: 'Failed to load competitor channels' },
      { status: 500 }
    );
  }
}