import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST() {
  try {
    // First try the regular refresh function
    let { error } = await supabase
      .rpc('refresh_topic_distribution_stats');

    if (error) {
      console.error('Error with regular refresh:', error);
      
      // If permissions error or function doesn't exist, try the simple version
      if (error.code === '42501' || error.code === '42883') {
        const { error: simpleError } = await supabase
          .rpc('refresh_topic_stats_simple');
          
        if (simpleError) {
          console.error('Error with simple refresh:', simpleError);
          
          // Last resort: return instructions for manual refresh
          return NextResponse.json({
            error: 'Unable to refresh automatically. Please run this SQL in Supabase SQL Editor:\n\nREFRESH MATERIALIZED VIEW topic_distribution_stats;',
            code: 'PERMISSION_DENIED'
          }, { status: 500 });
        }
      } else {
        throw error;
      }
    }

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