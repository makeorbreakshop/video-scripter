import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST() {
  try {
    // Call the refresh function
    const { error } = await supabase
      .rpc('refresh_topic_distribution_stats');

    if (error) throw error;

    return NextResponse.json({ 
      success: true, 
      message: 'Topic distribution statistics refreshed successfully' 
    });
  } catch (error) {
    console.error('Error refreshing topic stats:', error);
    return NextResponse.json(
      { error: 'Failed to refresh topic statistics' },
      { status: 500 }
    );
  }
}