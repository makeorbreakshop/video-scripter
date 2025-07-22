'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, TrendingUp, Calendar, Tag } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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
  metadata?: {
    tags?: string[];
    duration?: string;
    subscriberCount?: number;
  };
  view_tracking_priority?: {
    priority_tier?: number;
  };
}

interface VideoDetailModalProps {
  videoId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function VideoDetailModal({ videoId, isOpen, onClose }: VideoDetailModalProps) {
  const [video, setVideo] = useState<VideoDetails | null>(null);
  const [snapshots, setSnapshots] = useState<ViewSnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && videoId) {
      fetchVideoDetails();
    }
  }, [isOpen, videoId]);

  const fetchVideoDetails = async () => {
    setLoading(true);
    try {
      // Fetch video details
      const videoResponse = await fetch(`/api/videos/${videoId}`);
      if (!videoResponse.ok) throw new Error('Failed to fetch video details');
      const videoData = await videoResponse.json();
      setVideo(videoData);

      // Fetch view snapshots
      const snapshotsResponse = await fetch(`/api/videos/${videoId}/snapshots`);
      if (snapshotsResponse.ok) {
        const snapshotsData = await snapshotsResponse.json();
        setSnapshots(snapshotsData.snapshots || []);
      }
    } catch (error) {
      console.error('Error fetching video details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!video) return null;

  // Prepare chart data
  const chartData = snapshots.map(snapshot => ({
    date: new Date(snapshot.snapshot_date).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    }),
    views: snapshot.view_count,
    dailyRate: snapshot.daily_views_rate || 0
  }));

  // Calculate current velocity if we have snapshots
  const latestSnapshot = snapshots[snapshots.length - 1];
  const dailyVelocity = latestSnapshot?.daily_views_rate;

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US', { 
      notation: 'compact', 
      compactDisplay: 'short' 
    }).format(num);
  };

  const getYouTubeUrl = () => {
    return `https://www.youtube.com/watch?v=${video.id}`;
  };

  const getTierBadgeColor = (tier?: number) => {
    if (!tier) return 'secondary';
    if (tier <= 2) return 'default';
    if (tier <= 4) return 'secondary';
    return 'outline';
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">Video Details</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Header Section */}
            <div className="flex gap-4">
              {video.thumbnail_url && (
                <img 
                  src={video.thumbnail_url} 
                  alt={video.title}
                  className="w-48 h-27 object-cover rounded-lg"
                />
              )}
              <div className="flex-1 space-y-2">
                <h2 className="text-xl font-semibold line-clamp-2">{video.title}</h2>
                <p className="text-sm text-muted-foreground">{video.channel_name}</p>
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

            {/* View Performance Graph */}
            {chartData.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">View Performance</h3>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis tickFormatter={(value) => formatNumber(value)} />
                      <Tooltip 
                        formatter={(value: number) => formatNumber(value)}
                        labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="views" 
                        stroke="#8884d8" 
                        strokeWidth={2}
                        dot={{ fill: '#8884d8', r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Key Performance Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Current Views</p>
                <p className="text-2xl font-semibold">{formatNumber(video.view_count)}</p>
              </div>
              {video.performance_ratio && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Performance Ratio</p>
                  <p className="text-2xl font-semibold">{video.performance_ratio.toFixed(2)}x</p>
                  <p className="text-xs text-muted-foreground">vs channel avg</p>
                </div>
              )}
              {dailyVelocity && (
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Daily Velocity</p>
                  <p className="text-2xl font-semibold flex items-center gap-1">
                    <TrendingUp className="h-4 w-4" />
                    +{formatNumber(dailyVelocity)}
                  </p>
                  <p className="text-xs text-muted-foreground">views/day</p>
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
              <h3 className="text-sm font-medium">Content Classification</h3>
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
                {video.view_tracking_priority?.priority_tier && (
                  <Badge variant={getTierBadgeColor(video.view_tracking_priority.priority_tier)}>
                    Tier {video.view_tracking_priority.priority_tier}
                  </Badge>
                )}
              </div>
              {video.topic_domain && video.topic_niche && (
                <p className="text-sm text-muted-foreground">
                  {video.topic_domain} → {video.topic_niche} → {video.topic_micro || '...'}
                </p>
              )}
            </div>

            {/* YouTube Tags */}
            {video.metadata?.tags && video.metadata.tags.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium flex items-center gap-1">
                  <Tag className="h-4 w-4" />
                  YouTube Tags
                </h3>
                <div className="flex flex-wrap gap-1">
                  {video.metadata.tags.slice(0, 15).map((tag, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                  {video.metadata.tags.length > 15 && (
                    <Badge variant="outline" className="text-xs">
                      +{video.metadata.tags.length - 15} more
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {/* Quick Comparisons */}
            <div className="border-t pt-4 space-y-2">
              <h3 className="text-sm font-medium">Quick Insights</h3>
              <div className="space-y-1 text-sm">
                {video.performance_ratio && video.performance_ratio > 1 && (
                  <p className="text-green-600 dark:text-green-400">
                    ✓ Performing {video.performance_ratio.toFixed(1)}x better than channel average
                  </p>
                )}
                {video.performance_ratio && video.performance_ratio < 1 && (
                  <p className="text-orange-600 dark:text-orange-400">
                    ⚠ Performing at {(video.performance_ratio * 100).toFixed(0)}% of channel average
                  </p>
                )}
                {video.view_tracking_priority?.priority_tier && (
                  <p className="text-muted-foreground">
                    📊 Tier {video.view_tracking_priority.priority_tier} tracking priority
                    {video.view_tracking_priority.priority_tier <= 2 && ' (tracked daily)'}
                    {video.view_tracking_priority.priority_tier >= 5 && ' (tracked monthly)'}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}