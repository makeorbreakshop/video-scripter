/**
 * YouTube Analytics Video Count API Route
 * Returns the count of videos that will be processed by Analytics API
 */

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Get count of videos that match the Analytics API filtering criteria
    const { count, error } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('channel_id', 'Make or Break Shop') // Filter to specific channel
      .not('id', 'in', '(CHANNEL_TOTAL)'); // Exclude invalid IDs

    if (error) {
      console.error('❌ Error fetching video count:', error);
      return NextResponse.json(
        { error: 'Failed to fetch video count', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      count: count || 0,
      channel: 'Make or Break Shop',
      description: 'Number of videos that will be processed by Analytics API'
    });

  } catch (error) {
    console.error('❌ Video count API error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
}