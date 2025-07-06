'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { 
  Search, 
  Filter, 
  Play, 
  Users, 
  TrendingUp, 
  Calendar,
  CheckCircle,
  XCircle,
  Clock,
  Eye
} from 'lucide-react';
import { ReviewQueue } from '@/components/youtube/review-queue';

interface DiscoveryStats {
  method: string;
  totalDiscovered: number;
  pending: number;
  approved: number;
  rejected: number;
  recentDiscoveries: Array<{
    discoveredChannelId: string;
    channelTitle: string;
    subscriberCount: number;
    videoCount: number;
    validationStatus: string;
    discoveryDate: string;
    sourceChannelId?: string;
  }>;
}

interface OverallStats {
  totalChannels: number;
  pendingReview: number;
  approvedChannels: number;
  rejectedChannels: number;
  methodBreakdown: Array<{
    method: string;
    count: number;
    percentage: number;
  }>;
}

const DISCOVERY_METHODS = [
  { id: 'subscription', name: 'Subscription Discovery', description: 'From subscription lists' },
  { id: 'featured', name: 'Featured Channels', description: 'From channel featured sections' },
  { id: 'shelf', name: 'Multi-Channel Shelves', description: 'From channel sections' },
  { id: 'playlist', name: 'Playlist Creators', description: 'From playlist collaborations' },
  { id: 'comment', name: 'Comment Mining', description: 'From active commenters' },
  { id: 'collaboration', name: 'Collaboration Mining', description: 'From video mentions' },
];

const STATUS_COLORS = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444'
};

export default function DiscoveryDashboard() {
  const [overallStats, setOverallStats] = useState<OverallStats | null>(null);
  const [methodStats, setMethodStats] = useState<DiscoveryStats[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningDiscovery, setIsRunningDiscovery] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      // Load stats for each discovery method
      const methodPromises = DISCOVERY_METHODS.map(async (method) => {
        const response = await fetch(`/api/youtube/discovery/${method.id === 'subscription' ? 'subscriptions' : 
          method.id === 'featured' ? 'featured' :
          method.id === 'shelf' ? 'shelves' :
          method.id === 'playlist' ? 'playlists' :
          method.id === 'comment' ? 'comments' :
          'collaborations'}`);
        if (response.ok) {
          const data = await response.json();
          return {
            method: method.name,
            ...data.statistics,
            recentDiscoveries: data.recentDiscoveries || []
          };
        }
        return {
          method: method.name,
          totalDiscovered: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
          recentDiscoveries: []
        };
      });

      const stats = await Promise.all(methodPromises);
      setMethodStats(stats);

      // Calculate overall stats
      const totalChannels = stats.reduce((sum, stat) => sum + stat.totalDiscovered, 0);
      const pendingReview = stats.reduce((sum, stat) => sum + stat.pending, 0);
      const approvedChannels = stats.reduce((sum, stat) => sum + stat.approved, 0);
      const rejectedChannels = stats.reduce((sum, stat) => sum + stat.rejected, 0);

      const methodBreakdown = stats.map(stat => ({
        method: stat.method,
        count: stat.totalDiscovered,
        percentage: totalChannels > 0 ? Math.round((stat.totalDiscovered / totalChannels) * 100) : 0
      }));

      setOverallStats({
        totalChannels,
        pendingReview,
        approvedChannels,
        rejectedChannels,
        methodBreakdown
      });

    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const runDiscoveryMethod = async (methodId: string) => {
    setIsRunningDiscovery(true);
    try {
      const endpoint = methodId === 'subscription' ? 'subscriptions' : 
        methodId === 'featured' ? 'featured' :
        methodId === 'shelf' ? 'shelves' :
        methodId === 'playlist' ? 'playlists' :
        methodId === 'comment' ? 'comments' :
        'collaborations';

      const response = await fetch(`/api/youtube/discovery/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceChannelIds: ['all'],
          excludeExisting: true,
          dryRun: false
        }),
      });

      if (response.ok) {
        const result = await response.json();
        console.log(`Discovery completed: ${result.channelsDiscovered} channels found`);
        await loadDashboardData(); // Refresh data
      } else {
        const error = await response.json();
        console.error('Discovery failed:', error);
      }
    } catch (error) {
      console.error('Error running discovery:', error);
    } finally {
      setIsRunningDiscovery(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Channel Discovery Dashboard</h1>
          <p className="text-muted-foreground">Monitor and manage multi-method channel discovery</p>
        </div>
        <Button 
          onClick={() => loadDashboardData()} 
          variant="outline"
          disabled={isLoading}
        >
          Refresh Data
        </Button>
      </div>

      {/* Overall Statistics */}
      {overallStats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Discovered</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overallStats.totalChannels}</div>
              <p className="text-xs text-muted-foreground">Across all methods</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{overallStats.pendingReview}</div>
              <p className="text-xs text-muted-foreground">Need manual review</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Approved</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{overallStats.approvedChannels}</div>
              <p className="text-xs text-muted-foreground">Ready for import</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Rejected</CardTitle>
              <XCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{overallStats.rejectedChannels}</div>
              <p className="text-xs text-muted-foreground">Not relevant</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="methods">Methods</TabsTrigger>
          <TabsTrigger value="review">Review Queue</TabsTrigger>
          <TabsTrigger value="run">Run Discovery</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Method Performance Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Discovery by Method</CardTitle>
                <CardDescription>Channels discovered per method</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={methodStats}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="method" 
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      fontSize={12}
                    />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="totalDiscovered" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Status Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Review Status Distribution</CardTitle>
                <CardDescription>Current status of discovered channels</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Pending', value: overallStats?.pendingReview || 0, color: STATUS_COLORS.pending },
                        { name: 'Approved', value: overallStats?.approvedChannels || 0, color: STATUS_COLORS.approved },
                        { name: 'Rejected', value: overallStats?.rejectedChannels || 0, color: STATUS_COLORS.rejected }
                      ]}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {[STATUS_COLORS.pending, STATUS_COLORS.approved, STATUS_COLORS.rejected].map((color, index) => (
                        <Cell key={`cell-${index}`} fill={color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="methods" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {DISCOVERY_METHODS.map((method, index) => {
              const stats = methodStats[index];
              return (
                <Card key={method.id}>
                  <CardHeader>
                    <CardTitle className="text-lg">{method.name}</CardTitle>
                    <CardDescription>{method.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <span>Total:</span>
                      <Badge variant="secondary">{stats?.totalDiscovered || 0}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Pending:</span>
                      <Badge variant="outline" className="text-amber-600">{stats?.pending || 0}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Approved:</span>
                      <Badge variant="outline" className="text-green-600">{stats?.approved || 0}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Rejected:</span>
                      <Badge variant="outline" className="text-red-600">{stats?.rejected || 0}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="review" className="space-y-4">
          <ReviewQueue />
        </TabsContent>

        <TabsContent value="run" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Run Discovery Methods</CardTitle>
              <CardDescription>Execute discovery methods on all imported channels</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {DISCOVERY_METHODS.map((method) => (
                  <Card key={method.id}>
                    <CardHeader>
                      <CardTitle className="text-base">{method.name}</CardTitle>
                      <CardDescription className="text-sm">{method.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button 
                        onClick={() => runDiscoveryMethod(method.id)}
                        disabled={isRunningDiscovery}
                        className="w-full"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        {isRunningDiscovery ? 'Running...' : 'Run Discovery'}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}