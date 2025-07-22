import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get tracking statistics by tier - fetch counts for each tier separately to avoid pagination
    const tierCounts = [];
    for (let tier = 1; tier <= 6; tier++) {
      const { count, error } = await supabase
        .from('view_tracking_priority')
        .select('*', { count: 'exact', head: true })
        .eq('priority_tier', tier);
      
      if (!error && count !== null) {
        tierCounts.push({ tier, count });
      }
    }
    
    const tierStats = tierCounts.length > 0 ? tierCounts : null;
    const tierError = tierCounts.length === 0 ? new Error('No tier data found') : null;

    if (tierError) {
      console.error('Error fetching tier stats:', tierError);
      return NextResponse.json({ error: 'Failed to fetch tier statistics' }, { status: 500 });
    }

    // Get recent snapshots count
    const { data: recentSnapshots, error: snapshotError } = await supabase
      .rpc('count_snapshots_by_date', {
        p_days: 7
      });

    if (snapshotError) {
      console.error('Error fetching snapshot count:', snapshotError);
    }

    // Get today's tracking progress
    const today = new Date().toISOString().split('T')[0];
    const { data: todayProgress, error: progressError } = await supabase
      .from('view_snapshots')
      .select('video_id', { count: 'exact' })
      .eq('snapshot_date', today);

    if (progressError) {
      console.error('Error fetching today\'s progress:', progressError);
    }

    // Get recent tracking jobs
    const { data: recentJobs, error: jobsError } = await supabase
      .from('jobs')
      .select('id, status, created_at, updated_at, data')
      .eq('type', 'view_tracking')
      .order('created_at', { ascending: false })
      .limit(5);

    if (jobsError) {
      console.error('Error fetching recent jobs:', jobsError);
    }

    // Get videos with highest view velocity - join with videos table to get view counts
    const { data: topVelocity, error: velocityError } = await supabase
      .from('view_tracking_priority')
      .select(`
        video_id, 
        priority_score,
        videos!inner(view_count, title)
      `)
      .order('priority_score', { ascending: false })
      .limit(10);

    if (velocityError) {
      console.error('Error fetching top velocity videos:', velocityError);
    }

    // Get quota usage estimate
    const quotaUsage = {
      today: todayProgress?.count ? Math.ceil(todayProgress.count / 50) : 0,
      estimatedDaily: tierStats ? tierStats.reduce((sum, t) => {
        // Calculate based on tracking frequency for each tier
        if (t.tier === 1) return sum + t.count;           // Daily
        if (t.tier === 2) return sum + Math.ceil(t.count / 2);   // Every 2 days
        if (t.tier === 3) return sum + Math.ceil(t.count / 3);   // Every 3 days
        if (t.tier === 4) return sum + Math.ceil(t.count / 7);   // Weekly
        if (t.tier === 5) return sum + Math.ceil(t.count / 14);  // Biweekly
        if (t.tier === 6) return sum + Math.ceil(t.count / 30);  // Monthly
        return sum;
      }, 0) : 0
    };

    // Calculate estimated API calls
    quotaUsage.estimatedDailyCalls = Math.ceil(quotaUsage.estimatedDaily / 50);

    // Calculate what will be tracked if run now
    const willTrackByTier: Record<number, number> = {};
    const totalBatchSize = 2000 * 50; // 2000 API calls * 50 videos per call
    
    // Same distribution as ViewTrackingService
    const tierPercentages = {
      1: 0.25,
      2: 0.20,
      3: 0.20,
      4: 0.15,
      5: 0.15,
      6: 0.05
    };
    
    // Calculate how many from each tier will be tracked
    for (const [tier, percentage] of Object.entries(tierPercentages)) {
      const tierNum = parseInt(tier);
      const tierLimit = Math.floor(totalBatchSize * percentage);
      
      // Get count of videos in this tier that need tracking
      const { count: eligibleCount } = await supabase
        .from('view_tracking_priority')
        .select('*', { count: 'exact', head: true })
        .eq('priority_tier', tierNum)
        .or('next_track_date.is.null,next_track_date.lte.today()');
      
      // Will track minimum of eligible or tier limit
      willTrackByTier[tierNum] = Math.min(eligibleCount || 0, tierLimit);
    }
    
    const totalWillTrack = Object.values(willTrackByTier).reduce((sum, count) => sum + count, 0);

    // Get performance trends summary
    const { data: performanceTrends, error: trendsError } = await supabase
      .from('video_performance_trends')
      .select('video_id, current_views, week_1_views, month_1_views, daily_growth_after_week_1')
      .not('daily_growth_after_week_1', 'is', null)
      .order('daily_growth_after_week_1', { ascending: false })
      .limit(10);

    if (trendsError) {
      console.error('Error fetching performance trends:', trendsError);
    }

    return NextResponse.json({
      tierDistribution: tierStats || [],
      recentSnapshots: recentSnapshots || { count: 0 },
      todayProgress: {
        videosTracked: todayProgress?.count || 0,
        apiCallsUsed: quotaUsage.today
      },
      quotaUsage,
      recentJobs: recentJobs || [],
      topVelocityVideos: topVelocity || [],
      performanceTrends: performanceTrends || [],
      willTrackByTier: willTrackByTier || {},
      totalWillTrack: totalWillTrack || 0,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}

// Create the RPC function if it doesn't exist
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Create helper function for counting snapshots
    const { error } = await supabase.rpc('exec_sql', {
      sql: `
        CREATE OR REPLACE FUNCTION count_snapshots_by_date(p_days INTEGER DEFAULT 7)
        RETURNS TABLE (
          snapshot_date DATE,
          count BIGINT
        )
        LANGUAGE plpgsql
        AS $$
        BEGIN
          RETURN QUERY
          SELECT 
            vs.snapshot_date,
            COUNT(*)::BIGINT
          FROM view_snapshots vs
          WHERE vs.snapshot_date >= CURRENT_DATE - INTERVAL '1 day' * p_days
          GROUP BY vs.snapshot_date
          ORDER BY vs.snapshot_date DESC;
        END;
        $$;
      `
    });

    if (error) {
      console.error('Error creating function:', error);
      return NextResponse.json({ error: 'Failed to create helper function' }, { status: 500 });
    }

    return NextResponse.json({ message: 'Helper function created successfully' });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}