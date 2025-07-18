import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // Get the latest completed daily update
    const { data: latestUpdate, error } = await supabase
      .from('daily_update_logs')
      .select('*')
      .eq('status', 'complete')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      throw error;
    }

    if (!latestUpdate) {
      return NextResponse.json({
        hasResults: false,
        message: 'No completed daily updates found'
      });
    }

    return NextResponse.json({
      hasResults: true,
      operationId: latestUpdate.operation_id,
      completedAt: latestUpdate.completed_at,
      results: latestUpdate.results
    });

  } catch (error) {
    console.error('Error fetching latest daily update:', error);
    return NextResponse.json(
      { error: 'Failed to fetch latest update results' },
      { status: 500 }
    );
  }
}