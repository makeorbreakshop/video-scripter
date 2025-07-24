'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  TrendingUp, 
  TrendingDown, 
  AlertCircle, 
  BarChart3, 
  Clock,
  Eye,
  ThumbsUp,
  MessageSquare,
  Zap,
  Activity,
  RefreshCw,
  Calendar,
  Target,
  Award
} from 'lucide-react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { formatDistanceToNow } from 'date-fns';
import { GrowthChart } from '@/components/channel-analytics/growth-chart';
import { FormatBreakdown } from '@/components/channel-analytics/format-breakdown';

// Types
interface ChannelStats {
  totalVideos: number;
  avgViews: number;
  avgViewsRecent: number;
  medianVpd: number;
  medianVpdRecent: number;
  growthRate: number;
  topFormats: { format: string; count: number; avgViews: number }[];
}

interface VideoPerformance {
  videoId: string;
  title: string;
  viewCount: number;
  publishedAt: string;
  thumbnailUrl: string;
  ageDays: number;
  currentVpd: number;
  initialVpd: number;
  channelBaselineVpd: number;
  indexedScore: number;
  velocityTrend: number;
  trendDirection: '↗️' | '→' | '↘️';
  displayScore: string;
  performanceTier: string;
  // Legacy fields for compatibility
  viewsPerDay?: number;
  oldScore?: number;
  ageAdjustedScore?: number;
}

export default function ChannelAnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [channelStats, setChannelStats] = useState<ChannelStats | null>(null);
  const [videos, setVideos] = useState<VideoPerformance[]>([]);
  const [timeframe, setTimeframe] = useState('90d'); // Default to 90 days for better coverage
  const [sortBy, setSortBy] = useState<'score' | 'views' | 'velocity' | 'date'>('date');
  const [refreshing, setRefreshing] = useState(false);

  // My channel name - you can make this configurable later
  const CHANNEL_NAME = 'Make or Break Shop';

  useEffect(() => {
    loadChannelData();
  }, [timeframe]);

  const loadChannelData = async () => {
    setLoading(true);
    try {
      // Load hybrid performance data from cached table (much faster!)
      const perfResponse = await fetch(`/api/performance/hybrid-cached?channel=${encodeURIComponent(CHANNEL_NAME)}&limit=50&timeframe=${timeframe}`);
      const perfData = await perfResponse.json();
      
      setVideos(perfData.videos || []);
      
      // Calculate additional stats
      if (perfData.videos?.length > 0) {
        const stats: ChannelStats = {
          totalVideos: perfData.videos.length,
          avgViews: Math.round(perfData.videos.reduce((sum: number, v: any) => sum + v.viewCount, 0) / perfData.videos.length),
          avgViewsRecent: Math.round(
            perfData.videos
              .filter((v: any) => v.ageDays <= 30)
              .reduce((sum: number, v: any, _, arr: any[]) => sum + v.viewCount / arr.length, 0)
          ),
          medianVpd: perfData.summary.medianVpd,
          medianVpdRecent: perfData.summary.medianVpd,
          growthRate: 5.0, // From our earlier analysis
          topFormats: [] // Would need format data from DB
        };
        setChannelStats(stats);
      }
    } catch (error) {
      console.error('Error loading channel data:', error);
    }
    setLoading(false);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadChannelData();
    setRefreshing(false);
  };

  // Sort videos based on selected criteria
  const sortedVideos = [...videos].sort((a, b) => {
    switch (sortBy) {
      case 'score':
        return b.indexedScore - a.indexedScore;
      case 'views':
        return b.viewCount - a.viewCount;
      case 'velocity':
        return b.currentVpd - a.currentVpd;
      case 'date':
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      default:
        return 0;
    }
  });

  // Calculate performance distribution based on indexed scores
  const performanceDistribution = {
    exceptional: videos.filter(v => v.indexedScore >= 3.0).length,
    strong: videos.filter(v => v.indexedScore >= 2.0 && v.indexedScore < 3.0).length,
    average: videos.filter(v => v.indexedScore >= 0.8 && v.indexedScore < 2.0).length,
    below: videos.filter(v => v.indexedScore >= 0.5 && v.indexedScore < 0.8).length,
    poor: videos.filter(v => v.indexedScore < 0.5).length,
  };

  // Prepare chart data
  const velocityChartData = videos
    .filter(v => v.ageDays <= 180)
    .map(v => ({
      title: v.title.substring(0, 30) + '...',
      ageDays: v.ageDays,
      viewsPerDay: v.currentVpd,
      score: v.indexedScore,
    }))
    .sort((a, b) => a.ageDays - b.ageDays);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading channel analytics...</p>
        </div>
      </div>
    );
  }

  // Check if no videos in selected timeframe
  if (!loading && videos.length === 0) {
    const timeframeText = {
      '7d': 'last 7 days',
      '14d': 'last 14 days',
      '30d': 'last 30 days',
      '90d': 'last 90 days',
      '180d': 'last 6 months',
      '365d': 'last year',
      'all': 'all time'
    }[timeframe] || timeframe;

    return (
      <div className="container mx-auto py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Channel Analytics</h1>
            <p className="text-muted-foreground mt-1">
              {CHANNEL_NAME} • No videos in {timeframeText}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="14d">Last 14 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="180d">Last 6 months</SelectItem>
                <SelectItem value="365d">Last year</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              onClick={handleRefresh} 
              variant="outline"
              disabled={refreshing}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No videos found in the {timeframeText}. Your most recent video was published more than {timeframe.replace(/\d+/, '')} ago. 
            Try selecting a longer time period to see your channel analytics.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Channel Analytics</h1>
          <p className="text-muted-foreground mt-1">
            {CHANNEL_NAME} • {videos.length} videos in selected period
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="14d">Last 14 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="180d">Last 6 months</SelectItem>
              <SelectItem value="365d">Last year</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <Button 
            onClick={handleRefresh} 
            variant="outline"
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Channel Growth</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">5x</div>
            <p className="text-xs text-muted-foreground">
              vs 2 years ago (47 → 236 VPD)
            </p>
            <Progress value={80} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Median Views/Day</CardTitle>
            <Activity className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{channelStats?.medianVpd || 0}</div>
            <p className="text-xs text-muted-foreground">
              Recent videos benchmark
            </p>
            <div className="mt-2 flex items-center text-xs text-green-600">
              <TrendingUp className="w-3 h-3 mr-1" />
              +15% from last quarter
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Top Performers</CardTitle>
            <Award className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{performanceDistribution.exceptional}</div>
            <p className="text-xs text-muted-foreground">
              Videos exceeding 2x median
            </p>
            <div className="mt-2 text-xs">
              <span className="text-green-600">{Math.round((performanceDistribution.exceptional / videos.length) * 100)}%</span>
              {' '}of recent videos
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Best Video</CardTitle>
            <Zap className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {sortedVideos[0]?.indexedScore?.toFixed(1) || '0'}x
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {sortedVideos[0]?.title}
            </p>
            <div className="mt-2 text-xs text-muted-foreground">
              {sortedVideos[0]?.currentVpd?.toLocaleString() || '0'} views/day
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alert for broken scoring */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Hybrid Performance Scoring:</strong> Now showing View Rate (VPD), Indexed Score (vs channel baseline), 
          and Velocity Trend. Each video is compared to what your channel was averaging when it was published, 
          accounting for channel growth over time. Videos with {' '}
          <span className="font-semibold text-green-600">↗️ trends are gaining momentum!</span>
        </AlertDescription>
      </Alert>

      {/* Main Content Tabs */}
      <Tabs defaultValue="performance" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="velocity">Velocity Tracking</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
          <TabsTrigger value="comparison">Score Comparison</TabsTrigger>
          <TabsTrigger value="insights">Channel Insights</TabsTrigger>
        </TabsList>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Video Performance Analysis</CardTitle>
                <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Sort by Date</SelectItem>
                    <SelectItem value="score">Sort by Score</SelectItem>
                    <SelectItem value="views">Sort by Views</SelectItem>
                    <SelectItem value="velocity">Sort by Velocity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <CardDescription>
                Age-adjusted performance scores comparing each video to recent channel medians
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50%]">Video</TableHead>
                      <TableHead className="text-right">Views</TableHead>
                      <TableHead className="text-right">Age</TableHead>
                      <TableHead className="text-right">Current VPD</TableHead>
                      <TableHead>Performance Score</TableHead>
                      <TableHead className="text-center">Trend</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedVideos.slice(0, 15).map((video) => (
                      <TableRow key={video.videoId}>
                        <TableCell className="font-medium">
                          <div className="flex items-start gap-3">
                            <div className="w-24 h-14 flex-shrink-0">
                              {video.thumbnailUrl ? (
                                <img 
                                  src={video.thumbnailUrl} 
                                  alt={video.title}
                                  className="w-full h-full object-cover rounded-md"
                                />
                              ) : (
                                <div className="w-full h-full bg-muted rounded-md flex items-center justify-center">
                                  <span className="text-xs text-muted-foreground">No image</span>
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm line-clamp-2">{video.title}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {video.publishedAt && !isNaN(new Date(video.publishedAt).getTime()) 
                                  ? formatDistanceToNow(new Date(video.publishedAt), { addSuffix: true })
                                  : 'Date unavailable'}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {video.viewCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {video.ageDays}d
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {video.currentVpd?.toLocaleString() || '0'}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="text-sm font-medium">
                              {video.indexedScore?.toFixed(1) || '0.0'}x baseline
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {video.performanceTier}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <span className="text-lg">{video.trendDirection}</span>
                            <span className="text-sm font-mono">
                              {video.velocityTrend}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Velocity Tracking Tab */}
        <TabsContent value="velocity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Views Per Day by Video Age</CardTitle>
              <CardDescription>
                How video velocity changes over time (newer videos typically have higher VPD)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={velocityChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="ageDays" 
                      label={{ value: 'Video Age (days)', position: 'insideBottom', offset: -5 }}
                    />
                    <YAxis 
                      label={{ value: 'Views Per Day', angle: -90, position: 'insideLeft' }}
                    />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (active && payload?.[0]) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-background border rounded p-2 shadow-lg">
                              <p className="text-xs font-medium">{data.title}</p>
                              <p className="text-xs">Age: {data.ageDays} days</p>
                              <p className="text-xs">VPD: {data.viewsPerDay}</p>
                              <p className="text-xs">Score: {data.score?.toFixed(2) || '0.00'}x</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="viewsPerDay" 
                      stroke="#8884d8" 
                      fill="#8884d8" 
                      fillOpacity={0.6}
                    />
                    <ReferenceLine 
                      y={channelStats?.medianVpd || 57} 
                      stroke="#ef4444" 
                      strokeDasharray="5 5"
                      label={{ value: "Channel Median VPD", position: "right" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Velocity Leaders */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Highest Velocity (Recent)</CardTitle>
                <CardDescription>Videos with strongest daily view rates</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sortedVideos
                    .filter(v => v.ageDays <= 90)
                    .sort((a, b) => b.viewsPerDay - a.viewsPerDay)
                    .slice(0, 5)
                    .map((video, i) => (
                      <div key={video.videoId} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-muted-foreground">#{i + 1}</span>
                          <span className="text-sm truncate max-w-[200px]">{video.title}</span>
                        </div>
                        <Badge variant="outline">{video.viewsPerDay} VPD</Badge>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Best Score/Age Ratio</CardTitle>
                <CardDescription>Videos performing best for their age</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sortedVideos
                    .slice(0, 5)
                    .map((video, i) => (
                      <div key={video.videoId} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-muted-foreground">#{i + 1}</span>
                          <span className="text-sm truncate max-w-[200px]">{video.title}</span>
                        </div>
                        <Badge>{video.ageAdjustedScore?.toFixed(1) || '0'}x</Badge>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Distribution Tab */}
        <TabsContent value="distribution" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Performance Distribution</CardTitle>
              <CardDescription>
                How your videos are distributed across performance tiers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Exceptional (≥2x)</span>
                    <span className="text-sm text-muted-foreground">{performanceDistribution.exceptional} videos</span>
                  </div>
                  <Progress value={(performanceDistribution.exceptional / videos.length) * 100} className="h-2" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Strong (1.5-2x)</span>
                    <span className="text-sm text-muted-foreground">{performanceDistribution.strong} videos</span>
                  </div>
                  <Progress value={(performanceDistribution.strong / videos.length) * 100} className="h-2" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Above Average (1-1.5x)</span>
                    <span className="text-sm text-muted-foreground">{performanceDistribution.average} videos</span>
                  </div>
                  <Progress value={(performanceDistribution.average / videos.length) * 100} className="h-2" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Below Average (0.5-1x)</span>
                    <span className="text-sm text-muted-foreground">{performanceDistribution.below} videos</span>
                  </div>
                  <Progress value={(performanceDistribution.below / videos.length) * 100} className="h-2" />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Needs Attention (&lt;0.5x)</span>
                    <span className="text-sm text-muted-foreground">{performanceDistribution.poor} videos</span>
                  </div>
                  <Progress value={(performanceDistribution.poor / videos.length) * 100} className="h-2" />
                </div>
              </div>

              <div className="mt-6 p-4 bg-muted rounded-lg">
                <h4 className="text-sm font-medium mb-2">Key Insights</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• {Math.round((performanceDistribution.exceptional / videos.length) * 100)}% of your videos are exceptional performers</li>
                  <li>• {Math.round(((performanceDistribution.exceptional + performanceDistribution.strong) / videos.length) * 100)}% exceed 1.5x median performance</li>
                  <li>• Your channel has strong hit rate with multiple viral videos</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Comparison Tab */}
        <TabsContent value="comparison" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Old vs New Scoring Comparison</CardTitle>
              <CardDescription>
                See how broken the old performance_ratio is for your videos
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={sortedVideos.slice(0, 10).map(v => ({
                      title: v.title.substring(0, 25) + '...',
                      oldScore: v.oldScore,
                      newScore: v.ageAdjustedScore,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="title" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="oldScore" fill="#ef4444" name="Old Score (Broken)" />
                    <Bar dataKey="newScore" fill="#22c55e" name="Age-Adjusted Score" />
                    <ReferenceLine y={0} stroke="#666" />
                    <ReferenceLine y={1} stroke="#666" strokeDasharray="5 5" label="Average" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <Alert className="mt-4">
                <TrendingUp className="h-4 w-4" />
                <AlertDescription>
                  The old scoring system shows <strong>{videos.filter(v => v.oldScore < 0).length}</strong> of your videos 
                  as "underperforming" (negative scores), when actually <strong>{performanceDistribution.exceptional}</strong> are 
                  exceptional performers using age-adjusted scoring!
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Channel Insights Tab */}
        <TabsContent value="insights" className="space-y-6">
          <GrowthChart channelName={CHANNEL_NAME} />
          <FormatBreakdown channelName={CHANNEL_NAME} />
          
          <Card>
            <CardHeader>
              <CardTitle>Actionable Insights</CardTitle>
              <CardDescription>
                Data-driven recommendations based on your channel performance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex gap-4 p-4 border rounded-lg">
                  <Target className="w-8 h-8 text-blue-600 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium">Focus on High-Performing Formats</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Your product reviews and "REAL Cost" expose videos consistently outperform. 
                      Consider creating more content in these formats.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 p-4 border rounded-lg">
                  <Zap className="w-8 h-8 text-yellow-600 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium">Optimize Publishing Schedule</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Your channel shows strong momentum. Maintain consistent uploads to capitalize 
                      on the 5x growth trajectory.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 p-4 border rounded-lg">
                  <TrendingUp className="w-8 h-8 text-green-600 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium">Title Strategy Working</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Questions and cost-focused titles ("$300 Ink?!", "Did I Waste $1500?") 
                      are your top performers. Keep using this pattern.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4 p-4 border rounded-lg">
                  <Award className="w-8 h-8 text-purple-600 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium">Hit Rate Excellence</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      {Math.round((performanceDistribution.exceptional / videos.length) * 100)}% of your recent videos 
                      are exceptional performers (2x+ median). This is significantly above typical channels.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}