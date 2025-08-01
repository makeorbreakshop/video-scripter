import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check indexes
    const { data: indexes, error: indexError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          indexname, 
          tablename,
          pg_size_pretty(pg_relation_size(schemaname||'.'||indexname)) as index_size
        FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND (
          indexname LIKE 'idx_view_tracking%' 
          OR indexname LIKE 'idx_view_snapshots%' 
          OR indexname LIKE 'idx_videos_%' 
          OR indexname LIKE 'idx_jobs_%'
        )
        ORDER BY tablename, indexname;
      `
    });

    // Check functions
    const { data: functions, error: funcError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          proname as function_name,
          pg_get_function_identity_arguments(oid) as arguments
        FROM pg_proc
        WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        AND proname IN (
          'get_latest_snapshots_before_date',
          'get_videos_for_tracking',
          'update_tracking_dates_batch',
          'get_view_tracking_stats'
        )
        ORDER BY proname;
      `
    });

    // Check table row counts
    const { data: tableCounts, error: countError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT 
          'view_tracking_priority' as table_name,
          COUNT(*) as row_count
        FROM view_tracking_priority
        UNION ALL
        SELECT 
          'view_snapshots' as table_name,
          COUNT(*) as row_count
        FROM view_snapshots
        UNION ALL
        SELECT 
          'videos' as table_name,
          COUNT(*) as row_count
        FROM videos
        ORDER BY table_name;
      `
    });

    return NextResponse.json({
      indexes: indexes || [],
      functions: functions || [],
      tableCounts: tableCounts || [],
      errors: {
        indexError: indexError?.message,
        funcError: funcError?.message,
        countError: countError?.message
      }
    });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error.message
    }, { status: 500 });
  }
}