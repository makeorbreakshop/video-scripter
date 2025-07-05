'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Database, 
  Video, 
  Users, 
  Rss,
  TrendingUp,
  Eye,
  Clock,
  Calendar
} from 'lucide-react';

interface DatabaseStats {
  totalVideos: number;
  totalChannels: number;
  competitorVideos: number;
  competitorChannels: number;
  rssMonitoredChannels: number;
  embeddedVideos: number;
  recentVideos: number;
  averageViews: number;
}

export function DatabaseStatsCards() {
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/youtube/database-stats');
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch database stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) {
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

  if (!stats) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Failed to load database statistics</p>
        </CardContent>
      </Card>
    );
  }

  const embeddingCoverage = Math.round((stats.embeddedVideos / stats.totalVideos) * 100);
  const rssCoverage = Math.round((stats.rssMonitoredChannels / stats.competitorChannels) * 100);

  return (
    <>
      {/* Total Videos */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Videos</CardTitle>
          <Video className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalVideos.toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">
            {stats.competitorVideos.toLocaleString()} competitor videos
          </p>
        </CardContent>
      </Card>

      {/* Total Channels */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Channels</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalChannels}</div>
          <p className="text-xs text-muted-foreground">
            {stats.competitorChannels} competitor channels
          </p>
        </CardContent>
      </Card>

      {/* RSS Monitoring */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">RSS Monitoring</CardTitle>
          <Rss className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.rssMonitoredChannels}</div>
          <div className="flex items-center space-x-2">
            <p className="text-xs text-muted-foreground">
              {rssCoverage}% coverage
            </p>
            <Badge variant={rssCoverage >= 95 ? "default" : "secondary"} className="text-xs">
              {rssCoverage >= 95 ? "Excellent" : "Good"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Vector Embeddings */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Vector Embeddings</CardTitle>
          <Database className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.embeddedVideos.toLocaleString()}</div>
          <div className="flex items-center space-x-2">
            <p className="text-xs text-muted-foreground">
              {embeddingCoverage}% embedded
            </p>
            <Badge variant={embeddingCoverage === 100 ? "default" : "secondary"} className="text-xs">
              {embeddingCoverage === 100 ? "Complete" : "In Progress"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </>
  );
}