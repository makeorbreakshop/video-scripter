/**
 * Channel Overview Cards Component
 * Displays 30-day performance summary with trends
 */

'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Eye, ThumbsUp, MessageCircle, Target, Key } from 'lucide-react';
import { ChannelOverview } from './types';
import { isAuthenticated, initiateOAuthFlow } from '@/lib/youtube-oauth';

export function ChannelOverviewCards() {
  const [overview, setOverview] = useState<ChannelOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetchChannelOverview();
  }, []);

  const fetchChannelOverview = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/youtube/analytics/overview');
      if (!response.ok) {
        throw new Error('Failed to fetch channel overview');
      }

      const data = await response.json();
      setOverview(data);
    } catch (err) {
      console.error('Error fetching channel overview:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted || loading) {
    return <OverviewCardsSkeleton />;
  }

  if (error === 'not_authenticated') {
    return (
      <div className="col-span-full">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <Key className="h-12 w-12 mx-auto text-muted-foreground" />
              <div className="space-y-2">
                <h3 className="text-lg font-medium">YouTube Authentication Required</h3>
                <p className="text-sm text-muted-foreground">
                  Connect your YouTube account to view analytics data.
                </p>
              </div>
              <Button onClick={() => initiateOAuthFlow()} className="w-full">
                <Key className="h-4 w-4 mr-2" />
                Connect YouTube Account
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="col-span-full">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-destructive">Error loading overview: {error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="col-span-full">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">No data available</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const cards = [
    {
      title: 'Last 7 Days Views',
      value: overview.totalViews.toLocaleString(),
      subtitle: `${overview.dailyAverage.toLocaleString()}/day avg`,
      icon: Eye,
      trend: overview.trendViews,
      color: 'blue'
    },
    {
      title: 'Channel Average',
      value: `${overview.channelAverage.toLocaleString()}`,
      subtitle: 'views per video (lifetime)',
      icon: Target,
      trend: 0,
      color: 'green'
    },
    {
      title: 'Recent Retention',
      value: `${overview.averageRetention.toFixed(1)}%`,
      subtitle: 'average view percentage',
      icon: TrendingUp,
      trend: overview.trendRetention,
      color: 'purple'
    },
    {
      title: 'Watch Time',
      value: `${overview.watchHours}h`,
      subtitle: `${overview.totalLikes.toLocaleString()} lifetime likes`,
      icon: ThumbsUp,
      trend: 0,
      color: 'orange'
    }
  ];

  return (
    <>
      {cards.map((card: any, index: number) => (
        <Card key={index}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            <card.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            <p className="text-xs text-muted-foreground mb-2">
              {card.subtitle}
            </p>
            <div className="flex items-center space-x-2 text-xs text-muted-foreground">
              <TrendIndicator trend={card.trend} />
              <span>vs previous period</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

function TrendIndicator({ trend }: { trend: number }) {
  if (trend === 0) {
    return <span className="text-muted-foreground">No change</span>;
  }

  const isPositive = trend > 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const colorClass = isPositive ? 'text-green-600' : 'text-red-600';

  return (
    <div className={`flex items-center ${colorClass}`}>
      <Icon className="h-3 w-3 mr-1" />
      <span>{Math.abs(trend).toFixed(1)}%</span>
    </div>
  );
}

function OverviewCardsSkeleton() {
  return (
    <>
      {[...Array(4)].map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="h-4 w-20 bg-muted animate-pulse rounded" />
            <div className="h-4 w-4 bg-muted animate-pulse rounded" />
          </CardHeader>
          <CardContent>
            <div className="h-8 w-24 bg-muted animate-pulse rounded mb-2" />
            <div className="h-3 w-32 bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
      ))}
    </>
  );
}