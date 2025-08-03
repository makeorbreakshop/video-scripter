import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';
import { viewTrackingStatsCache } from '@/lib/simple-cache';

export async function GET(request: NextRequest) {
  try {
    // Check cache first
    const cacheKey = 'view-tracking-stats';
    const cached = viewTrackingStatsCache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get tracking statistics by tier using a more efficient query
    const { data: tierStats, error: tierError } = await supabase
      .from('view_tracking_priority')
      .select('priority_tier')
      .gte('priority_tier', 1)
      .lte('priority_tier', 6);
    
    // Count tiers in memory to avoid multiple queries
    const tierCounts: Record<number, number> = {};
    if (tierStats) {
      tierStats.forEach(row => {
        const tier = row.priority_tier;
        tierCounts[tier] = (tierCounts[tier] || 0) + 1;
      });
    }
    
    const tierStatsArray = Object.entries(tierCounts).map(([tier, count]) => ({
      tier: parseInt(tier),
      count: count
    })).sort((a, b) => a.tier - b.tier);

    if (tierError) {
      console.error('Error fetching tier stats:', tierError);
      return NextResponse.json({ error: 'Failed to fetch tier statistics' }, { status: 500 });
    }

    // Skip recent snapshots count for now - it's timing out
    // TODO: Add index on view_snapshots.snapshot_date to speed this up
    const recentSnapshots = null;

    // Get today's tracking progress - use head: true for faster count
    const today = new Date().toISOString().split('T')[0];
    const { count: todayCount, error: progressError } = await supabase
      .from('view_snapshots')
      .select('*', { count: 'exact', head: true })
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

    // For each job, count how many snapshots were created
    const jobsWithCounts = await Promise.all((recentJobs || []).map(async (job) => {
      const { count: snapshotCount } = await supabase
        .from('view_snapshots')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', job.created_at)
        .lte('created_at', job.updated_at);
      
      return {
        ...job,
        videosWithViews: snapshotCount || 0
      };
    }));

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
      today: todayCount ? Math.ceil(todayCount / 50) : 0,
      estimatedDaily: tierStatsArray ? tierStatsArray.reduce((sum, t) => {
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

    // Calculate what will be tracked if run now - use cached tier stats
    const willTrackByTier: Record<number, number> = {};
    const maxApiCalls = 333; // Default for "Run Daily Tracking" button
    const totalBatchSize = maxApiCalls * 50; // Total videos we can track
    
    // Use the tier stats we already fetched instead of making 6 more queries
    let remainingQuota = totalBatchSize;
    
    // Process tiers in order of priority (1-6) using existing tier counts
    for (const tierStat of tierStatsArray || []) {
      if (remainingQuota <= 0) break;
      
      // Estimate eligible videos as a percentage of total in tier
      // Tier 1 (daily) - assume all need tracking
      // Tier 2 (every 2 days) - assume 50% need tracking
      // Tier 3 (every 3 days) - assume 33% need tracking
      // etc.
      const eligiblePercentage = tierStat.tier === 1 ? 1 : 1 / tierStat.tier;
      const eligibleCount = Math.floor(tierStat.count * eligiblePercentage);
      
      // Will track up to remaining quota for this tier
      const trackCount = Math.min(eligibleCount, remainingQuota);
      willTrackByTier[tierStat.tier] = trackCount;
      remainingQuota -= trackCount;
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

    const responseData = {
      tierDistribution: tierStatsArray || [],
      recentSnapshots: recentSnapshots || { count: 0 },
      todayProgress: {
        videosTracked: todayCount || 0,
        apiCallsUsed: quotaUsage.today
      },
      quotaUsage,
      recentJobs: jobsWithCounts || [],
      topVelocityVideos: topVelocity || [],
      performanceTrends: performanceTrends || [],
      willTrackByTier: willTrackByTier || {},
      totalWillTrack: totalWillTrack || 0,
      lastUpdated: new Date().toISOString()
    };

    // Cache the successful response
    viewTrackingStatsCache.set(cacheKey, responseData);

    return NextResponse.json(responseData);

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