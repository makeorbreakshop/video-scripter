'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Area, AreaChart } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ArrowUpIcon, ArrowDownIcon, TrendingUpIcon, ActivityIcon, BarChart3, Sparkles, Clock, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VideoSnapshot {
  video_id: string;
  title: string;
  published_at: string;
  channel_name: string;
  snapshots: {
    age: number;
    views: number;
    date: string;
  }[];
  current_views: number;
  age_days: number;
  growth_curve?: {
    type: string;
    prediction_at_current_age: number;
    score: number;
  };
}

// Helper functions
function getScoreColor(score: number): string {
  if (score >= 1.5) return 'text-green-500';
  if (score >= 1.0) return 'text-blue-500';
  if (score >= 0.7) return 'text-yellow-500';
  return 'text-red-500';
}

function getScoreBadge(score: number) {
  if (score >= 1.5) return { label: 'Outperforming', variant: 'default' as const, icon: TrendingUpIcon };
  if (score >= 1.0) return { label: 'On Track', variant: 'secondary' as const, icon: ActivityIcon };
  if (score >= 0.7) return { label: 'Below Average', variant: 'outline' as const, icon: ArrowDownIcon };
  return { label: 'Underperforming', variant: 'destructive' as const, icon: ArrowDownIcon };
}

function fitPowerCurve(snapshots: { age: number; views: number }[]) {
  if (snapshots.length < 2) return null;
  
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  
  if (first.age === last.age || first.views <= 0 || last.views <= 0) return null;
  
  const b = Math.log(last.views / first.views) / Math.log(last.age / first.age);
  const a = first.views / Math.pow(first.age, b);
  
  return { a, b };
}

function fitGrowthCurve(points: { age: number; growth: number }[]) {
  if (!points || points.length < 2) return null;
  
  // Filter out invalid points
  const validPoints = points.filter(p => p.age > 0 && p.growth > 0);
  if (validPoints.length < 2) return null;
  
  // Simple power curve fitting: growth = a * age^b
  // Using two-point method for simplicity when we have limited data
  const sortedPoints = validPoints.sort((a, b) => a.age - b.age);
  
  // If we only have 2-3 points, use simple two-point fitting
  if (sortedPoints.length <= 3) {
    const p1 = sortedPoints[0];
    const p2 = sortedPoints[sortedPoints.length - 1];
    
    if (p1.age === p2.age) return null;
    
    const b = Math.log(p2.growth / p1.growth) / Math.log(p2.age / p1.age);
    const a = p1.growth / Math.pow(p1.age, b);
    
    return { a, b };
  }
  
  // For more points, use least squares
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  let n = 0;
  
  validPoints.forEach(p => {
    const x = Math.log(p.age);
    const y = Math.log(p.growth);
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    n++;
  });
  
  const denominator = n * sumX2 - sumX * sumX;
  if (Math.abs(denominator) < 0.0001) return null; // Avoid division by zero
  
  const b = (n * sumXY - sumX * sumY) / denominator;
  const a = Math.exp((sumY - b * sumX) / n);
  
  // Validate the curve parameters
  if (!isFinite(a) || !isFinite(b) || a <= 0) {
    console.warn('Invalid curve parameters:', { a, b });
    return null;
  }
  
  return { a, b };
}

function predictViews(curve: { a: number; b: number }, age: number) {
  return curve.a * Math.pow(age, curve.b);
}

function generateCurveData(video: VideoSnapshot, channelCurve: { a: number; b: number } | null) {
  if (!video.snapshots.length) return [];
  
  const maxAge = Math.max(video.age_days, ...video.snapshots.map(s => s.age));
  const points = [];
  
  // Add snapshot points
  video.snapshots.forEach(s => {
    points.push({
      age: s.age,
      actual: s.views,
      predicted: null,
      type: 'snapshot'
    });
  });
  
  // Generate expected curve based on channel median
  if (channelCurve && video.snapshots.length > 0) {
    const firstSnapshot = video.snapshots[0];
    
    if (firstSnapshot.views > 0) {
      // Generate smooth curve points
      const numPoints = 50;
      const step = maxAge * 1.2 / numPoints;
      
      for (let i = 0; i <= numPoints; i++) {
        const age = i * step;
        if (age < 0.1) continue; // Skip very early ages
        
        // Calculate expected views at this age based on channel curve
        // The curve represents typical growth pattern, normalized to first snapshot
        const growthAtFirstSnapshot = predictViews(channelCurve, firstSnapshot.age);
        const growthAtCurrentAge = predictViews(channelCurve, age);
        const relativeGrowth = growthAtCurrentAge / growthAtFirstSnapshot;
        const predicted = firstSnapshot.views * relativeGrowth;
        
        // Check if we already have a point at this age
        const existingPoint = points.find(p => Math.abs(p.age - age) < 0.01);
        
        if (existingPoint) {
          existingPoint.predicted = predicted;
        } else {
          points.push({
            age,
            actual: null,
            predicted: predicted,
            type: 'curve'
          });
        }
      }
    }
  }
  
  return points.sort((a, b) => a.age - b.age);
}

export default function AgeAdjustedDemoPage() {
  const [channels, setChannels] = useState<string[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [videos, setVideos] = useState<VideoSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<VideoSnapshot | null>(null);
  const [channelCurve, setChannelCurve] = useState<{ a: number; b: number } | null>(null);

  // Load available channels
  useEffect(() => {
    async function loadChannels() {
      const { data } = await supabase
        .from('videos')
        .select('channel_name')
        .order('channel_name');
      
      const uniqueChannels = [...new Set(data?.map(v => v.channel_name) || [])];
      setChannels(uniqueChannels);
    }
    loadChannels();
  }, []);

  // Load videos when channel selected
  useEffect(() => {
    if (!selectedChannel) return;

    async function loadChannelVideos() {
      setLoading(true);
      
      const { data: videos } = await supabase
        .from('videos')
        .select(`
          id,
          title,
          published_at,
          channel_name,
          view_count,
          view_snapshots (
            days_since_published,
            view_count,
            snapshot_date
          )
        `)
        .eq('channel_name', selectedChannel)
        .order('published_at', { ascending: false })
        .limit(30);

      if (!videos) {
        setLoading(false);
        return;
      }

      // First, build channel growth curve from all videos
      const allGrowthData: { age: number; growth: number }[] = [];
      
      videos.forEach(v => {
        if (v.view_snapshots && v.view_snapshots.length >= 2) {
          const snapshots = v.view_snapshots.sort((a, b) => a.days_since_published - b.days_since_published);
          const firstSnapshot = snapshots[0];
          
          if (firstSnapshot.view_count > 0) {
            snapshots.forEach(s => {
              allGrowthData.push({
                age: s.days_since_published,
                growth: s.view_count / firstSnapshot.view_count
              });
            });
          }
        }
      });

      // Group by age (integer days)
      const ageBuckets = new Map<number, number[]>();
      allGrowthData.forEach(d => {
        if (!ageBuckets.has(d.age)) {
          ageBuckets.set(d.age, []);
        }
        ageBuckets.get(d.age)!.push(d.growth);
      });

      // Calculate median growth for each age bucket
      const medianPoints = Array.from(ageBuckets.entries())
        .filter(([age, growths]) => age > 0 && growths.length > 0)
        .map(([age, growths]) => {
          const sorted = growths.sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          return { age, growth: median };
        })
        .sort((a, b) => a.age - b.age);

      // Fit channel curve to growth multiples
      console.log('Fitting curve with median points:', medianPoints);
      const channelGrowthCurve = fitGrowthCurve(medianPoints);
      console.log('Channel growth curve:', channelGrowthCurve);
      
      if (channelGrowthCurve) {
        console.log('Sample predictions:');
        for (let day of [1, 5, 10, 20, 30]) {
          console.log(`  Day ${day}: ${predictViews(channelGrowthCurve, day).toFixed(2)}x growth`);
        }
      }
      
      setChannelCurve(channelGrowthCurve);

      // Process videos with channel curve
      const processedVideos = videos
        .filter(v => v.view_snapshots?.length >= 3)
        .map(v => {
          const snapshots = v.view_snapshots
            .sort((a, b) => a.days_since_published - b.days_since_published)
            .map(s => {
              return {
                age: s.days_since_published, // Use the integer days from database
                views: s.view_count,
                date: s.snapshot_date
              };
            });

          // Calculate current age in whole days (matching snapshot format)
          const currentAge = Math.floor((Date.now() - new Date(v.published_at).getTime()) / (1000 * 60 * 60 * 24));

          // Calculate expected views based on channel curve
          let expectedViews = null;
          let score = null;
          
          if (channelGrowthCurve && snapshots[0] && snapshots[0].views > 0) {
            // The channel curve represents growth multiples relative to first snapshot
            const firstSnapshot = snapshots[0];
            // Get growth multiple at current age relative to first snapshot age
            const growthFromFirst = predictViews(channelGrowthCurve, currentAge) / 
                                   predictViews(channelGrowthCurve, firstSnapshot.age);
            expectedViews = firstSnapshot.views * growthFromFirst;
            score = v.view_count / expectedViews;
          } else if (snapshots.length >= 2) {
            // Fallback: simple linear interpolation if no channel curve
            const firstSnapshot = snapshots[0];
            const lastSnapshot = snapshots[snapshots.length - 1];
            const growthRate = (lastSnapshot.views - firstSnapshot.views) / (lastSnapshot.age - firstSnapshot.age);
            expectedViews = firstSnapshot.views + growthRate * (currentAge - firstSnapshot.age);
            score = v.view_count / expectedViews;
          }

          // Use the latest snapshot for current views since videos.view_count is stale
          const latestSnapshot = snapshots[snapshots.length - 1];
          const actualCurrentViews = latestSnapshot ? latestSnapshot.views : v.view_count;
          
          // Recalculate score with correct current views
          if (expectedViews && latestSnapshot) {
            score = actualCurrentViews / expectedViews;
          }
          
          return {
            video_id: v.id,
            title: v.title,
            published_at: v.published_at,
            channel_name: v.channel_name,
            snapshots,
            current_views: actualCurrentViews,
            age_days: currentAge,
            growth_curve: expectedViews ? {
              type: 'power',
              prediction_at_current_age: expectedViews,
              score: score || 0
            } : undefined
          };
        });

      setVideos(processedVideos);
      setLoading(false);
    }

    loadChannelVideos();
  }, [selectedChannel]);

  // These functions are now defined globally above

  const performanceGroups = {
    outperforming: videos.filter(v => v.growth_curve && v.growth_curve.score >= 1.5),
    onTrack: videos.filter(v => v.growth_curve && v.growth_curve.score >= 1.0 && v.growth_curve.score < 1.5),
    belowAverage: videos.filter(v => v.growth_curve && v.growth_curve.score >= 0.7 && v.growth_curve.score < 1.0),
    underperforming: videos.filter(v => v.growth_curve && v.growth_curve.score < 0.7)
  };

  return (
    <div className="flex-1 space-y-6 p-8">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Age-Adjusted Performance</h1>
            <p className="text-muted-foreground">
              Fair video scoring that accounts for age using growth curve modeling
            </p>
          </div>
        </div>

        {/* Channel Selector */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium">Channel</label>
              <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                <SelectTrigger className="w-[300px]">
                  <SelectValue placeholder="Select a channel to analyze..." />
                </SelectTrigger>
                <SelectContent>
                  {channels.map(channel => (
                    <SelectItem key={channel} value={channel}>
                      {channel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center space-y-3">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="text-muted-foreground">Loading channel data...</p>
          </div>
        </div>
      )}

      {!loading && videos.length > 0 && (
        <div className="space-y-6">
          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Videos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{videos.length}</div>
                <p className="text-xs text-muted-foreground mt-1">With 3+ snapshots</p>
              </CardContent>
            </Card>

            <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-green-600">Outperforming</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-bold text-green-600">
                    {performanceGroups.outperforming.length}
                  </div>
                  <span className="text-sm text-green-600">
                    ({Math.round(performanceGroups.outperforming.length / videos.length * 100)}%)
                  </span>
                </div>
                <Progress 
                  value={performanceGroups.outperforming.length / videos.length * 100} 
                  className="mt-2 h-1.5"
                />
              </CardContent>
            </Card>

            <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-blue-600">On Track</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-bold text-blue-600">
                    {performanceGroups.onTrack.length}
                  </div>
                  <span className="text-sm text-blue-600">
                    ({Math.round(performanceGroups.onTrack.length / videos.length * 100)}%)
                  </span>
                </div>
                <Progress 
                  value={performanceGroups.onTrack.length / videos.length * 100} 
                  className="mt-2 h-1.5"
                />
              </CardContent>
            </Card>

            <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-red-600">Underperforming</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <div className="text-2xl font-bold text-red-600">
                    {performanceGroups.underperforming.length}
                  </div>
                  <span className="text-sm text-red-600">
                    ({Math.round(performanceGroups.underperforming.length / videos.length * 100)}%)
                  </span>
                </div>
                <Progress 
                  value={performanceGroups.underperforming.length / videos.length * 100} 
                  className="mt-2 h-1.5"
                />
              </CardContent>
            </Card>
          </div>

          {/* Video Tabs */}
          <Tabs defaultValue="all" className="space-y-4">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="all">All Videos</TabsTrigger>
              <TabsTrigger value="outperforming" className="text-green-600">
                Outperforming ({performanceGroups.outperforming.length})
              </TabsTrigger>
              <TabsTrigger value="ontrack" className="text-blue-600">
                On Track ({performanceGroups.onTrack.length})
              </TabsTrigger>
              <TabsTrigger value="below" className="text-yellow-600">
                Below ({performanceGroups.belowAverage.length})
              </TabsTrigger>
              <TabsTrigger value="under" className="text-red-600">
                Under ({performanceGroups.underperforming.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="space-y-4">
              {videos.slice(0, 10).map(video => (
                <VideoCard key={video.video_id} video={video} channelCurve={channelCurve} onSelect={setSelectedVideo} />
              ))}
            </TabsContent>

            <TabsContent value="outperforming" className="space-y-4">
              {performanceGroups.outperforming.map(video => (
                <VideoCard key={video.video_id} video={video} channelCurve={channelCurve} onSelect={setSelectedVideo} />
              ))}
            </TabsContent>

            <TabsContent value="ontrack" className="space-y-4">
              {performanceGroups.onTrack.map(video => (
                <VideoCard key={video.video_id} video={video} channelCurve={channelCurve} onSelect={setSelectedVideo} />
              ))}
            </TabsContent>

            <TabsContent value="below" className="space-y-4">
              {performanceGroups.belowAverage.map(video => (
                <VideoCard key={video.video_id} video={video} channelCurve={channelCurve} onSelect={setSelectedVideo} />
              ))}
            </TabsContent>

            <TabsContent value="under" className="space-y-4">
              {performanceGroups.underperforming.map(video => (
                <VideoCard key={video.video_id} video={video} channelCurve={channelCurve} onSelect={setSelectedVideo} />
              ))}
            </TabsContent>
          </Tabs>
        </div>
      )}

      {/* Detail Modal */}
      {selectedVideo && (
        <VideoDetailModal video={selectedVideo} channelCurve={channelCurve} onClose={() => setSelectedVideo(null)} />
      )}
    </div>
  );
}

function VideoCard({ video, channelCurve, onSelect }: { video: VideoSnapshot; channelCurve: { a: number; b: number } | null; onSelect: (video: VideoSnapshot) => void }) {
  const scoreInfo = video.growth_curve ? getScoreBadge(video.growth_curve.score) : null;
  const Icon = scoreInfo?.icon || ActivityIcon;

  return (
    <Card 
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        video.growth_curve && video.growth_curve.score >= 1.5 && "border-green-200 bg-green-50/30 dark:bg-green-950/10",
        video.growth_curve && video.growth_curve.score < 0.7 && "border-red-200 bg-red-50/30 dark:bg-red-950/10"
      )}
      onClick={() => onSelect(video)}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-1">
            <h3 className="font-semibold text-lg line-clamp-1">{video.title}</h3>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                <span>{video.age_days} days old</span>
              </div>
              <div className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                <span>{video.current_views?.toLocaleString()} views</span>
              </div>
            </div>
          </div>

          {video.growth_curve && scoreInfo && (
            <div className="flex flex-col items-end gap-2">
              <Badge variant={scoreInfo.variant} className="gap-1">
                <Icon className="h-3.5 w-3.5" />
                {scoreInfo.label}
              </Badge>
              <div className="text-right">
                <div className={cn("text-2xl font-bold", getScoreColor(video.growth_curve.score))}>
                  {video.growth_curve.score.toFixed(2)}x
                </div>
                <p className="text-xs text-muted-foreground">
                  {((video.growth_curve.score - 1) * 100).toFixed(0)}% 
                  {video.growth_curve.score >= 1 ? ' above' : ' below'} expected
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Mini Chart Preview */}
        <div className="mt-4 h-24">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={generateCurveData(video, channelCurve)}>
              <defs>
                <linearGradient id={`gradient-${video.video_id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <Area 
                type="monotone" 
                dataKey="predicted" 
                stroke="#8884d8" 
                fillOpacity={1}
                fill={`url(#gradient-${video.video_id})`}
              />
              <Line 
                type="monotone" 
                dataKey="actual" 
                stroke="#10b981" 
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function VideoDetailModal({ video, channelCurve, onClose }: { video: VideoSnapshot; channelCurve: { a: number; b: number } | null; onClose: () => void }) {
  const scoreInfo = video.growth_curve ? getScoreBadge(video.growth_curve.score) : null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50" onClick={onClose}>
      <div className="fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] w-full max-w-4xl">
        <Card className="max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-xl">{video.title}</CardTitle>
                <CardDescription className="mt-2">
                  Published {new Date(video.published_at).toLocaleDateString()} • {video.age_days} days ago
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Performance Summary */}
            {video.growth_curve && scoreInfo && (
              <div className="grid grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">Current Views</p>
                      <p className="text-2xl font-bold mt-1">{video.current_views?.toLocaleString()}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">Expected Views</p>
                      <p className="text-2xl font-bold mt-1">
                        {Math.round(video.growth_curve.prediction_at_current_age).toLocaleString()}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">Performance Score</p>
                      <div className="flex items-center justify-center gap-2 mt-1">
                        <p className={cn("text-2xl font-bold", getScoreColor(video.growth_curve.score))}>
                          {video.growth_curve.score.toFixed(2)}x
                        </p>
                        <Badge variant={scoreInfo.variant} className="scale-90">
                          {scoreInfo.label}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Growth Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Growth Trajectory</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={generateCurveData(video, channelCurve)}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="age" 
                        label={{ value: 'Days Since Published', position: 'insideBottom', offset: -5 }}
                      />
                      <YAxis 
                        tickFormatter={(value) => {
                          if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                          if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
                          return value;
                        }}
                      />
                      <Tooltip 
                        formatter={(value: any) => {
                          if (!value) return 'N/A';
                          return parseInt(value).toLocaleString();
                        }}
                      />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="predicted" 
                        stroke="#8b5cf6" 
                        strokeDasharray="5 5"
                        dot={false}
                        name="Expected (Channel Median)"
                      />
                      <Line 
                        type="monotone" 
                        dataKey="actual" 
                        stroke="#10b981" 
                        strokeWidth={3}
                        dot={{ fill: '#10b981', r: 5 }}
                        name="Actual Performance"
                      />
                      {video.age_days && (
                        <ReferenceLine 
                          x={video.age_days} 
                          stroke="#ef4444" 
                          strokeDasharray="3 3"
                          label={{ value: "Today", position: "top" }}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Data Points */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Snapshot Data</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {video.snapshots.map((snapshot, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                          {i + 1}
                        </div>
                        <div>
                          <p className="text-sm font-medium">Day {Math.round(snapshot.age)}</p>
                          <p className="text-xs text-muted-foreground">{new Date(snapshot.date).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{snapshot.views.toLocaleString()} views</p>
                        {i > 0 && (
                          <p className="text-xs text-muted-foreground">
                            +{((snapshot.views / video.snapshots[i-1].views - 1) * 100).toFixed(1)}% growth
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}