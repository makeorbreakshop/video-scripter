'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Users, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Search,
  TrendingUp
} from 'lucide-react';

interface DiscoveryOverviewStats {
  totalDiscovered: number;
  pendingReview: number;
  approvedChannels: number;
  rejectedChannels: number;
  topMethod: string;
  recentDiscoveries: number;
}

export function DiscoveryStatsCards() {
  const [stats, setStats] = useState<DiscoveryOverviewStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadOverviewStats();
  }, []);

  const loadOverviewStats = async () => {
    setIsLoading(true);
    try {
      // Load stats from all discovery methods
      const methods = ['subscriptions', 'featured', 'shelves', 'playlists', 'comments', 'collaborations'];
      
      const promises = methods.map(async (method) => {
        try {
          const response = await fetch(`/api/youtube/discovery/${method}`);
          if (response.ok) {
            const data = await response.json();
            return {
              method,
              ...data.statistics,
              recentDiscoveries: data.recentDiscoveries || []
            };
          }
          return {
            method,
            totalDiscovered: 0,
            pending: 0,
            approved: 0,
            rejected: 0,
            recentDiscoveries: []
          };
        } catch (error) {
          console.error(`Error loading ${method} stats:`, error);
          return {
            method,
            totalDiscovered: 0,
            pending: 0,
            approved: 0,
            rejected: 0,
            recentDiscoveries: []
          };
        }
      });

      const methodStats = await Promise.all(promises);
      
      // Calculate overall stats
      const totalDiscovered = methodStats.reduce((sum, stat) => sum + (stat.totalDiscovered || 0), 0);
      const pendingReview = methodStats.reduce((sum, stat) => sum + (stat.pending || 0), 0);
      const approvedChannels = methodStats.reduce((sum, stat) => sum + (stat.approved || 0), 0);
      const rejectedChannels = methodStats.reduce((sum, stat) => sum + (stat.rejected || 0), 0);
      
      // Find top performing method
      const topMethodData = methodStats.reduce((max, stat) => 
        (stat.totalDiscovered || 0) > (max.totalDiscovered || 0) ? stat : max
      );
      
      const topMethod = topMethodData.method === 'subscriptions' ? 'Subscriptions' :
        topMethodData.method === 'featured' ? 'Featured Channels' :
        topMethodData.method === 'shelves' ? 'Shelves' :
        topMethodData.method === 'playlists' ? 'Playlists' :
        topMethodData.method === 'comments' ? 'Comments' :
        'Collaborations';
      
      // Count recent discoveries (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const recentDiscoveries = methodStats.reduce((sum, stat) => {
        const recent = (stat.recentDiscoveries || []).filter((discovery: any) => {
          const discoveryDate = new Date(discovery.discoveryDate);
          return discoveryDate > sevenDaysAgo;
        });
        return sum + recent.length;
      }, 0);

      setStats({
        totalDiscovered,
        pendingReview,
        approvedChannels,
        rejectedChannels,
        topMethod,
        recentDiscoveries
      });

    } catch (error) {
      console.error('Error loading discovery overview stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <>
        {[1, 2, 3, 4].map(i => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 w-20 bg-gray-200 rounded animate-pulse"></div>
              <div className="h-4 w-4 bg-gray-200 rounded animate-pulse"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 w-24 bg-gray-200 rounded animate-pulse mb-2"></div>
              <div className="h-3 w-32 bg-gray-200 rounded animate-pulse"></div>
            </CardContent>
          </Card>
        ))}
      </>
    );
  }

  if (!stats) {
    return (
      <Card className="col-span-4">
        <CardContent className="p-6">
          <p className="text-muted-foreground text-center">
            Failed to load discovery statistics
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Discovered</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalDiscovered}</div>
          <p className="text-xs text-muted-foreground">
            Channels found across all methods
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-amber-600">{stats.pendingReview}</div>
          <p className="text-xs text-muted-foreground">
            Awaiting manual validation
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-600">{stats.recentDiscoveries}</div>
          <p className="text-xs text-muted-foreground">
            New discoveries this week
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Top Method</CardTitle>
          <Search className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-lg font-bold text-green-600">{stats.topMethod}</div>
          <div className="flex items-center space-x-2 mt-1">
            <Badge variant="outline" className="text-green-600">
              <CheckCircle className="h-3 w-3 mr-1" />
              {stats.approvedChannels} approved
            </Badge>
          </div>
        </CardContent>
      </Card>
    </>
  );
}