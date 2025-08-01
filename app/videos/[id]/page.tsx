'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, TrendingUp, Calendar, BarChart3, Search, ArrowLeft, Sparkles } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, ReferenceLine } from 'recharts';
import Image from 'next/image';
import Link from 'next/link';

interface ViewSnapshot {
  snapshot_date: string;
  view_count: number;
  like_count?: number;
  comment_count?: number;
  daily_views_rate?: number;
}

interface VideoDetails {
  id: string;
  title: string;
  channel_name: string;
  channel_id: string;
  thumbnail_url?: string;
  published_at: string;
  view_count: number;
  like_count?: number;
  comment_count?: number;
  performance_ratio?: number;
  channel_avg_views?: number;
  format_type?: string;
  format_confidence?: number;
  topic_domain?: string;
  topic_niche?: string;
  topic_micro?: string;
  topic_confidence?: number;
  llm_summary?: string;
  llm_summary_generated_at?: string;
  llm_summary_model?: string;
  metadata?: {
    tags?: string[];
    duration?: string;
    subscriberCount?: number;
  };
  view_tracking_priority?: {
    priority_tier?: number;
  };
  video_performance_metrics?: {
    age_days?: number;
    current_vpd?: number;
    initial_vpd?: number;
    channel_baseline_vpd?: number;
    indexed_score?: number;
    velocity_trend?: number;
    trend_direction?: '↗️' | '→' | '↘️';
    performance_tier?: string;
    last_calculated_at?: string;
  };
  performance_envelope?: Array<{
    day_since_published: number;
    p10_views: number;
    p25_views: number;
    p50_views: number;
    p75_views: number;
    p90_views: number;
  }>;
}

interface SimilarVideo {
  id: string;
  title: string;
  channel_name: string;
  thumbnail_url?: string;
  view_count: number;
  published_at: string;
  similarity_score: number;
}

interface SimilarVideosResults {
  byTitle: SimilarVideo[];
  byDescription: SimilarVideo[];
  byThumbnail: SimilarVideo[];
}

export default function VideoDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const videoId = params.id as string;
  
  const [video, setVideo] = useState<VideoDetails | null>(null);
  const [snapshots, setSnapshots] = useState<ViewSnapshot[]>([]);
  const [similarVideos, setSimilarVideos] = useState<SimilarVideosResults>({
    byTitle: [],
    byDescription: [],
    byThumbnail: []
  });
  const [loading, setLoading] = useState(true);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('stats');

  useEffect(() => {
    if (videoId) {
      fetchVideoDetails();
    }
  }, [videoId]);

  useEffect(() => {
    if (videoId && activeTab === 'similar' && similarVideos.byTitle.length === 0) {
      fetchSimilarVideos();
    }
  }, [videoId, activeTab]);

  const fetchVideoDetails = async () => {
    setLoading(true);
    try {
      const videoResponse = await fetch(`/api/videos/${videoId}`);
      if (!videoResponse.ok) throw new Error('Failed to fetch video details');
      const videoData = await videoResponse.json();
      console.log('Video data:', videoData);
      console.log('Performance metrics:', videoData.video_performance_metrics);
      setVideo(videoData);

      const snapshotsResponse = await fetch(`/api/videos/${videoId}/snapshots`);
      if (snapshotsResponse.ok) {
        const snapshotsData = await snapshotsResponse.json();
        console.log('Snapshots data:', snapshotsData);
        setSnapshots(snapshotsData.snapshots || []);
      }
    } catch (error) {
      console.error('Error fetching video details:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSimilarVideos = async () => {
    setSimilarLoading(true);
    try {
      const [titleRes, descriptionRes, thumbnailRes] = await Promise.all([
        fetch(`/api/vector/search/title?videoId=${videoId}&limit=9`),
        fetch(`/api/vector/search/description?videoId=${videoId}&limit=9`),
        fetch(`/api/vector/search/thumbnail?videoId=${videoId}&limit=9`)
      ]);

      const [titleData, descriptionData, thumbnailData] = await Promise.all([
        titleRes.ok ? titleRes.json() : { videos: [] },
        descriptionRes.ok ? descriptionRes.json() : { videos: [] },
        thumbnailRes.ok ? thumbnailRes.json() : { videos: [] }
      ]);

      setSimilarVideos({
        byTitle: titleData.videos || [],
        byDescription: descriptionData.videos || [],
        byThumbnail: thumbnailData.videos || []
      });
    } catch (error) {
      console.error('Error fetching similar videos:', error);
    } finally {
      setSimilarLoading(false);
    }
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US', { 
      notation: 'compact', 
      compactDisplay: 'short' 
    }).format(num);
  };

  const getYouTubeUrl = () => {
    if (!video) return '';
    return `https://www.youtube.com/watch?v=${video.id}`;
  };

  const renderSimilarVideosGrid = (videos: SimilarVideo[], searchType: string, icon: string) => {
    if (videos.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          No similar videos found by {searchType}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span>{icon}</span>
          Similar by {searchType}
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {videos.map((similarVideo) => (
            <Link href={`/videos/${similarVideo.id}`} key={similarVideo.id}>
              <div className="group cursor-pointer">
                <div className="relative aspect-video rounded-lg overflow-hidden bg-muted">
                  {similarVideo.thumbnail_url ? (
                    <Image 
                      src={similarVideo.thumbnail_url} 
                      alt={similarVideo.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-4xl">📺</div>
                    </div>
                  )}
                  <div className="absolute top-2 right-2">
                    <Badge variant="secondary" className="bg-black/70 text-white">
                      {Math.round(similarVideo.similarity_score * 100)}%
                    </Badge>
                  </div>
                </div>
                <div className="mt-2">
                  <h4 className="font-medium line-clamp-2 text-sm group-hover:text-primary transition-colors">
                    {similarVideo.title}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">{similarVideo.channel_name}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{formatNumber(similarVideo.view_count)} views</span>
                    <span>•</span>
                    <span>{formatDistanceToNow(new Date(similarVideo.published_at), { addSuffix: true })}</span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    );
  };

  if (!video) return null;

  // Get latest snapshot data
  const latestSnapshot = snapshots[snapshots.length - 1];
  const dailyVelocity = latestSnapshot?.daily_views_rate;

  // Create chart data combining actual snapshots with performance envelope
  const chartData: any[] = [];
  const publishedDate = video.published_at ? new Date(video.published_at) : new Date();
  
  // Add performance envelope data (expected growth curves)
  if (video.performance_envelope && video.performance_envelope.length > 0) {
    const channelBaseline = video.video_performance_metrics?.channel_baseline_vpd || 1397;
    
    // Find day 7 reference point for scaling
    const day7Envelope = video.performance_envelope.find(env => env.day_since_published === 7) || 
                         video.performance_envelope.find(env => env.day_since_published >= 5 && env.day_since_published <= 10);
    
    // Calculate scale factor based on channel baseline
    const scaleFactor = day7Envelope ? (channelBaseline * 7) / day7Envelope.p50_views : 0.5;
    
    video.performance_envelope.forEach(env => {
      const date = new Date(publishedDate);
      date.setDate(date.getDate() + env.day_since_published);
      
      const p10 = Math.round(env.p10_views * scaleFactor);
      const p25 = Math.round(env.p25_views * scaleFactor);
      const p50 = Math.round(env.p50_views * scaleFactor);
      const p75 = Math.round(env.p75_views * scaleFactor);
      const p90 = Math.round(env.p90_views * scaleFactor);
      
      chartData.push({
        day: env.day_since_published,
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        p10: p10,
        p25: p25,
        p50: p50,
        p75: p75,
        p90: p90,
        // Pre-calculated band heights for stacking
        band1: p10,                    // 0-10%
        band2: p25 - p10,              // 10-25%
        band3: p50 - p25,              // 25-50%
        band4: p75 - p50,              // 50-75%
        band5: p90 - p75,              // 75-90%
        actualViews: null
      });
    });
  }
  
  // Add actual snapshot data
  snapshots.forEach(snapshot => {
    const snapshotDate = new Date(snapshot.snapshot_date);
    const daysSincePublished = Math.floor(
      (snapshotDate.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    // Find matching envelope data point or create new one
    let dataPoint = chartData.find(d => d.day === daysSincePublished);
    if (!dataPoint) {
      dataPoint = {
        day: daysSincePublished,
        date: snapshotDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        actualViews: snapshot.view_count,
        p10: null,
        p25: null,
        p50: null,
        p75: null,
        p90: null,
        band1: null,
        band2: null,
        band3: null,
        band4: null,
        band5: null
      };
      chartData.push(dataPoint);
    } else {
      dataPoint.actualViews = snapshot.view_count;
    }
  });
  
  // Sort by day
  chartData.sort((a, b) => a.day - b.day);
  
  // Limit chart data to reasonable range
  const maxDay = Math.max(...chartData.filter(d => d.actualViews !== null).map(d => d.day), 30);
  const filteredChartData = chartData.filter(d => d.day <= maxDay * 1.2);
  
  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="stats" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Stats & Metadata
            </TabsTrigger>
            <TabsTrigger value="similar" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Similar Videos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="stats" className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <>
              {/* Header Section */}
              <div className="flex gap-6">
                <div className="relative w-64 aspect-video rounded-lg overflow-hidden bg-muted flex-shrink-0">
                  {video.thumbnail_url ? (
                    <Image 
                      src={video.thumbnail_url} 
                      alt={video.title}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-6xl">📺</div>
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <h1 className="text-2xl font-bold line-clamp-2">{video.title}</h1>
                  <p className="text-lg text-muted-foreground">{video.channel_name}</p>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {formatDistanceToNow(new Date(video.published_at), { addSuffix: true })}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(getYouTubeUrl(), '_blank')}
                    >
                      <ExternalLink className="h-4 w-4 mr-1" />
                      YouTube
                    </Button>
                  </div>
                </div>
              </div>

              {/* View Performance Graph - Senior Designer Redesign */}
              {chartData.length > 0 && (
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-gray-900 dark:to-gray-800/50 p-8">
                  {/* Decorative background element */}
                  <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-blue-500/10 to-purple-500/10 blur-3xl" />
                  
                  {/* Header with Performance Status */}
                  <div className="relative flex items-start justify-between mb-8">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="h-1 w-12 rounded-full bg-gradient-to-r from-blue-500 to-purple-500" />
                        <h3 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Performance Trajectory</h3>
                      </div>
                      <p className="text-base text-gray-600 dark:text-gray-400 max-w-lg">
                        Your video's growth journey compared to {video.channel_name}'s historical performance baseline
                      </p>
                    </div>
                    {video.video_performance_metrics?.performance_tier && (
                      <div className="flex flex-col items-end gap-3">
                        <div className={
                          video.video_performance_metrics.performance_tier === 'Viral' 
                            ? 'px-6 py-3 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 text-white shadow-lg shadow-green-500/25' :
                          video.video_performance_metrics.performance_tier === 'Outperforming' 
                            ? 'px-6 py-3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-500/25' :
                          video.video_performance_metrics.performance_tier === 'On Track' 
                            ? 'px-6 py-3 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300' :
                            'px-6 py-3 rounded-full bg-gradient-to-r from-red-500 to-pink-500 text-white shadow-lg shadow-red-500/25'
                        }>
                          <div className="flex items-center gap-2">
                            <TrendingUp className="h-5 w-5" />
                            <span className="font-semibold">{video.video_performance_metrics.performance_tier}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                            {video.video_performance_metrics.indexed_score ? video.video_performance_metrics.indexed_score.toFixed(2) : '0.00'}x
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {video.video_performance_metrics.indexed_score && video.video_performance_metrics.indexed_score > 1 
                              ? `${((video.video_performance_metrics.indexed_score - 1) * 100).toFixed(0)}% above`
                              : video.video_performance_metrics.indexed_score 
                                ? `${((1 - video.video_performance_metrics.indexed_score) * 100).toFixed(0)}% below`
                                : ''
                            } baseline
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* Chart Container */}
                  <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl shadow-gray-200/50 dark:shadow-gray-950/50 p-6">
                    <div className="h-96 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={filteredChartData} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
                        <defs>
                          <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.05}/>
                          </linearGradient>
                        </defs>
                        
                        <CartesianGrid strokeDasharray="0" stroke="#e5e7eb" vertical={false} />
                        <XAxis 
                          dataKey="date" 
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#6b7280', fontSize: 11 }}
                          dy={10}
                        />
                        <YAxis 
                          tickFormatter={(value) => formatNumber(value)} 
                          domain={[0, 'auto']}
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#6b7280', fontSize: 11 }}
                          dx={-10}
                        />
                        
                        <Tooltip 
                          content={({ active, payload, label }) => {
                            if (!active || !payload || payload.length === 0) return null;
                            const data = payload[0].payload;
                            const actualViews = data.actualViews;
                            const expectedViews = data.p50;
                            
                            return (
                              <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
                                <p className="font-semibold text-gray-900 dark:text-gray-100 mb-2">{label}</p>
                                
                                {actualViews && (
                                  <div className="mb-3">
                                    <p className="text-xs text-gray-600 dark:text-gray-400">Actual Performance</p>
                                    <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{formatNumber(actualViews)} views</p>
                                    {expectedViews && (
                                      <p className="text-sm mt-1">
                                        <span className={actualViews > expectedViews ? "text-green-600" : "text-red-600"}>
                                          {actualViews > expectedViews 
                                            ? `+${((actualViews / expectedViews - 1) * 100).toFixed(0)}%`
                                            : `-${((1 - actualViews / expectedViews) * 100).toFixed(0)}%`
                                          } vs expected
                                        </span>
                                      </p>
                                    )}
                                  </div>
                                )}
                                
                                {data.p50 && (
                                  <div className="space-y-1 text-xs">
                                    <div className="flex justify-between items-center">
                                      <span className="text-gray-600 dark:text-gray-400">Top 10%</span>
                                      <span className="font-semibold">{formatNumber(data.p90)}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-gray-600 dark:text-gray-400">Top 25%</span>
                                      <span className="font-semibold">{formatNumber(data.p75)}</span>
                                    </div>
                                    <div className="flex justify-between items-center font-semibold">
                                      <span>Median</span>
                                      <span>{formatNumber(data.p50)}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-gray-600 dark:text-gray-400">Bottom 25%</span>
                                      <span className="font-semibold">{formatNumber(data.p25)}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                      <span className="text-gray-600 dark:text-gray-400">Bottom 10%</span>
                                      <span className="font-semibold">{formatNumber(data.p10)}</span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          }}
                        />
                        
                        {/* Performance bands - stacked areas */}
                        {filteredChartData.some(d => d.band1 !== undefined) && (
                          <>
                            {/* Bottom 10% band */}
                            <Area
                              type="monotone"
                              dataKey="band1"
                              stackId="1"
                              stroke="none"
                              fill="#fecaca"
                              fillOpacity={0.6}
                            />
                            
                            {/* 10-25% band */}
                            <Area
                              type="monotone"
                              dataKey="band2"
                              stackId="1"
                              stroke="none"
                              fill="#fed7aa"
                              fillOpacity={0.6}
                            />
                            
                            {/* 25-50% band */}
                            <Area
                              type="monotone"
                              dataKey="band3"
                              stackId="1"
                              stroke="none"
                              fill="#fef3c7"
                              fillOpacity={0.6}
                            />
                            
                            {/* 50-75% band */}
                            <Area
                              type="monotone"
                              dataKey="band4"
                              stackId="1"
                              stroke="none"
                              fill="#dbeafe"
                              fillOpacity={0.6}
                            />
                            
                            {/* 75-90% band */}
                            <Area
                              type="monotone"
                              dataKey="band5"
                              stackId="1"
                              stroke="none"
                              fill="#bbf7d0"
                              fillOpacity={0.6}
                            />
                            
                            {/* Median line */}
                            <Line 
                              type="monotone" 
                              dataKey="p50" 
                              stroke="#4b5563" 
                              strokeWidth={2}
                              strokeDasharray="5 5"
                              dot={false}
                            />
                          </>
                        )}
                        
                        {/* Actual performance with gradient fill */}
                        <Area
                          type="monotone"
                          dataKey="actualViews"
                          stroke="none"
                          fill="url(#actualFill)"
                        />
                        
                        {/* Actual performance line */}
                        <Line 
                          type="monotone" 
                          dataKey="actualViews" 
                          stroke="#8b5cf6" 
                          strokeWidth={3}
                          dot={{ fill: '#8b5cf6', stroke: '#ffffff', strokeWidth: 2, r: 4 }}
                          activeDot={{ r: 6 }}
                        />
                        
                        {/* Current marker */}
                        {video.video_performance_metrics && chartData.length > 0 && (
                          <ReferenceLine 
                            x={chartData[chartData.length - 1]?.date} 
                            stroke="#ef4444" 
                            strokeDasharray="3 3"
                            label={{ value: "Current", position: "top", fill: "#ef4444", fontSize: 12 }}
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  </div>
                  
                  {/* Performance Insights Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
                    {/* Current Status */}
                    <div className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-xl p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="h-5 w-5 text-purple-600" />
                        <h4 className="font-semibold text-gray-900 dark:text-gray-100">Current Status</h4>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">View Count</p>
                          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{formatNumber(video.view_count)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">Daily Velocity</p>
                          <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            {video.video_performance_metrics?.current_vpd 
                              ? `${formatNumber(Math.round(video.video_performance_metrics.current_vpd))} views/day`
                              : 'N/A'
                            }
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    {/* Performance Analysis */}
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <TrendingUp className="h-5 w-5 text-green-600" />
                        <h4 className="font-semibold text-gray-900 dark:text-gray-100">Performance Analysis</h4>
                      </div>
                      <div className="space-y-3">
                        {video.video_performance_metrics?.indexed_score && video.video_performance_metrics.indexed_score >= 3 && (
                          <div className="flex items-start gap-2">
                            <div className="mt-1 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              <span className="font-semibold">Viral Performance:</span> This video is achieving exceptional growth, far exceeding typical channel performance
                            </p>
                          </div>
                        )}
                        {video.video_performance_metrics?.indexed_score && video.video_performance_metrics.indexed_score >= 1.5 && video.video_performance_metrics.indexed_score < 3 && (
                          <div className="flex items-start gap-2">
                            <div className="mt-1 h-2 w-2 rounded-full bg-blue-500" />
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              <span className="font-semibold">Strong Performance:</span> Outperforming your channel's typical videos by a significant margin
                            </p>
                          </div>
                        )}
                        {video.video_performance_metrics?.indexed_score && video.video_performance_metrics.indexed_score < 1 && (
                          <div className="flex items-start gap-2">
                            <div className="mt-1 h-2 w-2 rounded-full bg-orange-500" />
                            <p className="text-sm text-gray-700 dark:text-gray-300">
                              <span className="font-semibold">Growth Opportunity:</span> Currently below channel baseline - consider promotional strategies
                            </p>
                          </div>
                        )}
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                          Channel baseline: {formatNumber(Math.round(video.video_performance_metrics?.channel_baseline_vpd || 0))} daily views
                        </p>
                      </div>
                    </div>
                    
                    {/* Legend */}
                    <div className="bg-gradient-to-br from-gray-50 to-slate-50 dark:from-gray-800 dark:to-slate-800 rounded-xl p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <Sparkles className="h-5 w-5 text-gray-600" />
                        <h4 className="font-semibold text-gray-900 dark:text-gray-100">Chart Legend</h4>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#bbf7d0' }} />
                          <span className="text-sm text-gray-700 dark:text-gray-300">Top 10% (75-90%)</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#dbeafe' }} />
                          <span className="text-sm text-gray-700 dark:text-gray-300">Above Average (50-75%)</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#fef3c7' }} />
                          <span className="text-sm text-gray-700 dark:text-gray-300">Average (25-50%)</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#fed7aa' }} />
                          <span className="text-sm text-gray-700 dark:text-gray-300">Below Average (10-25%)</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#fecaca' }} />
                          <span className="text-sm text-gray-700 dark:text-gray-300">Bottom 10%</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-0.5 bg-gray-600" />
                          <span className="text-sm text-gray-700 dark:text-gray-300">Channel Median</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-1 bg-purple-500 rounded-full" />
                          <span className="text-sm text-gray-700 dark:text-gray-300">Your Video</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Key Performance Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Current Views</p>
                  <p className="text-2xl font-semibold">{formatNumber(video.view_count)}</p>
                </div>
                {(video.video_performance_metrics?.indexed_score || video.performance_ratio) && (
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Performance Score</p>
                    <p className="text-2xl font-semibold">
                      {video.video_performance_metrics?.indexed_score 
                        ? `${video.video_performance_metrics.indexed_score.toFixed(2)}x`
                        : `${video.performance_ratio?.toFixed(2)}x`
                      }
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {video.video_performance_metrics?.indexed_score 
                        ? "age-adjusted baseline"
                        : "vs channel avg"
                      }
                    </p>
                  </div>
                )}
                {(video.video_performance_metrics?.current_vpd || dailyVelocity) && (
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Daily Velocity</p>
                    <p className="text-2xl font-semibold flex items-center gap-1">
                      {video.video_performance_metrics?.trend_direction && (
                        <span className="text-lg">{video.video_performance_metrics.trend_direction}</span>
                      )}
                      {video.video_performance_metrics?.current_vpd 
                        ? formatNumber(Math.round(video.video_performance_metrics.current_vpd))
                        : dailyVelocity ? `+${formatNumber(dailyVelocity)}` : 'N/A'
                      }
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {video.video_performance_metrics?.velocity_trend 
                        ? `views/day (${video.video_performance_metrics.velocity_trend > 0 ? '+' : ''}${Math.round(video.video_performance_metrics.velocity_trend)}%)`
                        : "views/day"
                      }
                    </p>
                  </div>
                )}
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Days Since Published</p>
                  <p className="text-2xl font-semibold">
                    {Math.floor((Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24))}
                  </p>
                </div>
              </div>

              {/* Content Classification */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Content Classification</h3>
                <div className="flex flex-wrap gap-2">
                  {video.format_type && (
                    <Badge variant="secondary">
                      Format: {video.format_type}
                      {video.format_confidence && (
                        <span className="ml-1 opacity-70">
                          ({Math.round(video.format_confidence * 100)}%)
                        </span>
                      )}
                    </Badge>
                  )}
                  {video.topic_micro && (
                    <Badge variant="outline">
                      Topic: {video.topic_micro}
                      {video.topic_confidence && (
                        <span className="ml-1 opacity-70">
                          ({Math.round(video.topic_confidence * 100)}%)
                        </span>
                      )}
                    </Badge>
                  )}
                </div>
              </div>

              {/* AI Summary */}
              {video.llm_summary && (
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold">AI Summary</h3>
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm">{video.llm_summary}</p>
                  </div>
                </div>
              )}
            </>
          )}
          </TabsContent>

          <TabsContent value="similar" className="space-y-8">
          {similarLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <>
              {renderSimilarVideosGrid(similarVideos.byTitle, 'Title Vector', '📝')}
              {renderSimilarVideosGrid(similarVideos.byDescription, 'Description Vector', '📄')}
              {renderSimilarVideosGrid(similarVideos.byThumbnail, 'Thumbnail Vector', '🖼️')}
            </>
          )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}