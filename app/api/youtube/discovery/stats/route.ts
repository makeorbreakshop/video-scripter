// API Route: Discovery Statistics
// Provides analytics and metrics for the discovery system

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase-client';
import { youtubeDiscoveryAPI } from '@/lib/youtube-discovery-api';
import { subscriptionCrawler } from '@/lib/subscription-crawler';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const period = url.searchParams.get('period') || '7'; // days
    const detailed = url.searchParams.get('detailed') === 'true';

    const daysBack = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Get discovery metrics from database
    const { data: metrics, error: metricsError } = await supabase
      .from('discovery_metrics')
      .select('*')
      .gte('date', startDate.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (metricsError) {
      console.error('Error fetching discovery metrics:', metricsError);
    }

    // Get discovery data
    const { data: discoveries, error: discoveryError } = await supabase
      .from('channel_discovery')
      .select('*')
      .gte('discovery_date', startDate.toISOString())
      .order('discovery_date', { ascending: false });

    if (discoveryError) {
      console.error('Error fetching discoveries:', discoveryError);
    }

    // Get current quota usage
    const quotaUsage = youtubeDiscoveryAPI.getQuotaUsage();

    // Get current session status
    const currentSession = subscriptionCrawler.getSessionStatus();

    // Calculate statistics
    const totalDiscovered = discoveries?.length || 0;
    const totalApproved = discoveries?.filter(d => d.validation_status === 'approved').length || 0;
    const totalRejected = discoveries?.filter(d => d.validation_status === 'rejected').length || 0;
    const totalPending = discoveries?.filter(d => d.validation_status === 'pending').length || 0;
    const totalImported = discoveries?.filter(d => d.import_status === 'completed').length || 0;

    // Calculate daily averages
    const totalQuotaUsed = metrics?.reduce((sum, m) => sum + (m.quota_used_total || 0), 0) || 0;
    const avgDailyQuota = daysBack > 0 ? totalQuotaUsed / daysBack : 0;
    const avgDailyDiscoveries = daysBack > 0 ? totalDiscovered / daysBack : 0;

    // Calculate success rates
    const approvalRate = totalDiscovered > 0 ? (totalApproved / totalDiscovered * 100) : 0;
    const importSuccessRate = totalApproved > 0 ? (totalImported / totalApproved * 100) : 0;

    // Get top source channels
    const sourceChannelStats = discoveries?.reduce((acc, d) => {
      acc[d.source_channel_id] = (acc[d.source_channel_id] || 0) + 1;
      return acc;
    }, {} as Record<string, number>) || {};

    const topSources = Object.entries(sourceChannelStats)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([channelId, count]) => ({ channelId, discoveries: count }));

    const response: any = {
      period: `${daysBack} days`,
      summary: {
        totalDiscovered,
        totalApproved,
        totalRejected,
        totalPending,
        totalImported,
        approvalRate: Math.round(approvalRate * 100) / 100,
        importSuccessRate: Math.round(importSuccessRate * 100) / 100
      },
      quotaUsage: {
        today: quotaUsage,
        avgDaily: Math.round(avgDailyQuota),
        totalPeriod: totalQuotaUsed,
        efficiency: totalDiscovered > 0 ? Math.round(totalQuotaUsed / totalDiscovered * 100) / 100 : 0
      },
      performance: {
        avgDailyDiscoveries: Math.round(avgDailyDiscoveries * 100) / 100,
        discoveryTrend: metrics?.length >= 2 ? 
          (metrics[0]?.channels_discovered || 0) - (metrics[1]?.channels_discovered || 0) : 0
      },
      currentSession: currentSession ? {
        id: currentSession.id,
        status: currentSession.status,
        progress: currentSession.totalChannels > 0 ? 
          Math.round(currentSession.processedChannels / currentSession.totalChannels * 100) : 0,
        discovered: currentSession.channelsDiscovered,
        quotaUsed: currentSession.quotaUsed
      } : null
    };

    if (detailed) {
      response.detailed = {
        dailyMetrics: metrics || [],
        topSourceChannels: topSources,
        recentDiscoveries: discoveries?.slice(0, 20).map(d => ({
          channelId: d.discovered_channel_id,
          title: d.channel_metadata?.title || 'Unknown',
          sourceChannel: d.source_channel_id,
          status: d.validation_status,
          score: d.relevance_score,
          discoveryDate: d.discovery_date,
          subscriberCount: d.subscriber_count,
          videoCount: d.video_count
        })) || []
      };
    }

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error getting discovery stats:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get discovery statistics',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'updateMetrics') {
      // Update daily metrics
      await subscriptionCrawler.updateDailyMetrics();
      
      return NextResponse.json({
        message: 'Daily metrics updated successfully'
      });

    } else if (action === 'resetQuota') {
      // Reset quota tracking (for new day)
      youtubeDiscoveryAPI.resetQuotaTracking();
      
      return NextResponse.json({
        message: 'Quota tracking reset successfully'
      });

    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use "updateMetrics" or "resetQuota"' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('Error updating discovery stats:', error);
    return NextResponse.json(
      { 
        error: 'Failed to update discovery statistics',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}