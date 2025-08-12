'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, TrendingUp, Users, BarChart3, CheckCircle2, Activity, Trophy } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';

interface DatabaseStats {
  total_videos: number;
  total_channels: number;
  average_views: string;
  videos_added_today: number;
  videos_added_this_week: number;
  videos_added_this_month: number;
  channels_added_this_week: number;
  channels_added_this_month: number;
  daily_average_last_30: string;
  total_views_tracked: number;
  videos_over_1m: number;
  percent_over_1m: string;
  top_channel_name: string;
  active_channels_30d: number;
  active_percent: string;
  channel_size_distribution: {
    'Mega (>1M)': number;
    'Large (100K-1M)': number;
    'Medium (10K-100K)': number;
    'Small (<10K)': number;
  };
  complete_coverage_percent: string;
}

export function DatabaseOverview() {
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats();
    // Refresh every 5 minutes
    const interval = setInterval(fetchStats, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const { data, error } = await supabase
        .from('analytics_stats')
        .select(`
          total_videos,
          total_channels,
          average_views
        `)
        .single();

      if (error) throw error;

      // Fetch from other materialized views
      const [growthData, performanceData, channelData, qualityData] = await Promise.all([
        supabase.from('database_growth_stats').select('*').single(),
        supabase.from('database_performance_stats').select('*').single(),
        supabase.from('database_channel_health').select('*').single(),
        supabase.from('database_data_quality').select('*').single()
      ]);

      if (growthData.error) throw growthData.error;
      if (performanceData.error) throw performanceData.error;
      if (channelData.error) throw channelData.error;
      if (qualityData.error) throw qualityData.error;

      setStats({
        ...data,
        ...growthData.data,
        ...performanceData.data,
        ...channelData.data,
        complete_coverage_percent: qualityData.data.complete_coverage_percent
      });
    } catch (err) {
      console.error('Error fetching stats:', err);
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num: number | string) => {
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (n >= 1000000000) return `${(n / 1000000000).toFixed(1)}B`;
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toFixed(0);
  };

  const formatLargeNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <p className="text-red-600">Failed to load database stats: {error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Core Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Videos</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatLargeNumber(stats.total_videos)}</div>
            <p className="text-xs text-muted-foreground">
              {formatNumber(stats.average_views)} avg views
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Channels</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatLargeNumber(stats.total_channels)}</div>
            <p className="text-xs text-muted-foreground">
              {stats.active_channels_30d} active ({stats.active_percent}%)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Views</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(stats.total_views_tracked)}</div>
            <p className="text-xs text-muted-foreground">
              Across all videos
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Growth Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Growth Momentum
          </CardTitle>
          <CardDescription>Content being added to the database</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Today</p>
              <p className="text-2xl font-bold">{formatNumber(stats.videos_added_today)}</p>
              <p className="text-xs text-muted-foreground">videos</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">This Week</p>
              <p className="text-2xl font-bold">{formatNumber(stats.videos_added_this_week)}</p>
              <p className="text-xs text-muted-foreground">videos</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">This Month</p>
              <p className="text-2xl font-bold">{formatNumber(stats.videos_added_this_month)}</p>
              <p className="text-xs text-muted-foreground">videos</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Daily Avg (30d)</p>
              <p className="text-2xl font-bold">{formatNumber(stats.daily_average_last_30)}</p>
              <p className="text-xs text-muted-foreground">videos/day</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">New channels this month</span>
              <span className="font-medium">{stats.channels_added_this_month}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Performance Highlights */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Performance Highlights
            </CardTitle>
            <CardDescription>Top performing content</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Videos over 1M views</span>
                <span className="text-sm font-medium">{stats.percent_over_1m}%</span>
              </div>
              <Progress value={parseFloat(stats.percent_over_1m)} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {formatNumber(stats.videos_over_1m)} videos
              </p>
            </div>
            <div className="pt-4 border-t">
              <p className="text-sm text-muted-foreground mb-1">Top Channel</p>
              <p className="text-lg font-semibold">{stats.top_channel_name}</p>
            </div>
          </CardContent>
        </Card>

        {/* Channel Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Channel Distribution
            </CardTitle>
            <CardDescription>By subscriber count</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(stats.channel_size_distribution).map(([size, count]) => (
                <div key={size} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${
                      size.includes('Mega') ? 'bg-purple-500' :
                      size.includes('Large') ? 'bg-blue-500' :
                      size.includes('Medium') ? 'bg-green-500' :
                      'bg-gray-500'
                    }`} />
                    <span className="text-sm">{size}</span>
                  </div>
                  <span className="text-sm font-medium">{count}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Active channels (30d)</span>
                <span className="font-medium">{stats.active_percent}%</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Data Coverage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            Data Coverage
          </CardTitle>
          <CardDescription>
            Videos with embeddings, format, and topic classification
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Progress value={parseFloat(stats.complete_coverage_percent)} className="h-3" />
            </div>
            <div className="text-2xl font-bold">
              {stats.complete_coverage_percent}%
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Complete data coverage across all processing pipelines
          </p>
        </CardContent>
      </Card>
    </div>
  );
}