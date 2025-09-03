import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    
    // Need at least 2 characters for autocomplete
    if (query.length < 2) {
      return NextResponse.json({ suggestions: [] });
    }

    const supabase = getSupabase();
    
    // Use the optimized autocomplete function we created
    const { data, error } = await supabase
      .rpc('search_channels_autocomplete_fixed', {
        query_text: query,
        max_results: 8
      });

    if (error) {
      console.error('Autocomplete error:', error);
      return NextResponse.json({ suggestions: [] });
    }

    // Format the response
    const suggestions = (data || []).map((channel: any) => ({
      id: channel.channel_id,
      name: channel.channel_name,
      thumbnail: channel.thumbnail_url,
      subscriberCount: channel.subscriber_count
    }));

    return NextResponse.json({ 
      suggestions,
      query,
      cached: false 
    });

  } catch (error) {
    console.error('Autocomplete API error:', error);
    return NextResponse.json({ suggestions: [] });
  }
}