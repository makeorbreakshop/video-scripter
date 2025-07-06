'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Eye, 
  ThumbsUp, 
  ThumbsDown, 
  ExternalLink,
  Users,
  Video,
  TrendingUp,
  Filter
} from 'lucide-react';

interface ReviewChannel {
  discovered_channel_id: string;
  channel_title: string;
  subscriber_count: number;
  video_count: number;
  discovery_count: number;
  discovery_methods: string;
  first_discovery: string;
  relevance_score: number;
}

interface ReviewQueueFilters {
  sortBy: string;
  sortOrder: string;
  minSubscribers: number;
  minVideos: number;
  limit: number;
}

export function ReviewQueue() {
  const [channels, setChannels] = useState<ReviewChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<ReviewQueueFilters>({
    sortBy: 'subscriber_count',
    sortOrder: 'desc',
    minSubscribers: 1000,
    minVideos: 10,
    limit: 25
  });
  const [isProcessing, setIsProcessing] = useState<string | null>(null);

  useEffect(() => {
    loadReviewQueue();
  }, [filters]);

  const loadReviewQueue = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        minSubscribers: filters.minSubscribers.toString(),
        minVideos: filters.minVideos.toString(),
        limit: filters.limit.toString()
      });

      const response = await fetch(`/api/youtube/discovery/review-queue?${params}`);
      if (response.ok) {
        const data = await response.json();
        setChannels(data.channels || []);
      } else {
        console.error('Failed to load review queue');
      }
    } catch (error) {
      console.error('Error loading review queue:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChannelAction = async (channelId: string, action: 'approve' | 'reject') => {
    setIsProcessing(channelId);
    try {
      const response = await fetch('/api/youtube/discovery/review-queue', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelId,
          action,
          reason: action === 'reject' ? 'Manual review rejection' : 'Manual review approval'
        }),
      });

      if (response.ok) {
        // Remove the channel from the list
        setChannels(prev => prev.filter(c => c.discovered_channel_id !== channelId));
      } else {
        console.error(`Failed to ${action} channel`);
      }
    } catch (error) {
      console.error(`Error ${action}ing channel:`, error);
    } finally {
      setIsProcessing(null);
    }
  };

  const updateFilter = (key: keyof ReviewQueueFilters, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const getSubscriberTier = (count: number) => {
    if (count >= 10000000) return { tier: '10M+', color: 'bg-purple-100 text-purple-800' };
    if (count >= 1000000) return { tier: '1M+', color: 'bg-blue-100 text-blue-800' };
    if (count >= 100000) return { tier: '100K+', color: 'bg-green-100 text-green-800' };
    if (count >= 10000) return { tier: '10K+', color: 'bg-yellow-100 text-yellow-800' };
    return { tier: '<10K', color: 'bg-gray-100 text-gray-800' };
  };

  const getRelevanceColor = (score: number) => {
    if (score >= 30) return 'bg-red-100 text-red-800';
    if (score >= 20) return 'bg-orange-100 text-orange-800';
    if (score >= 10) return 'bg-blue-100 text-blue-800';
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Review Queue Filters
          </CardTitle>
          <CardDescription>Filter and sort channels for review</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <Label htmlFor="sortBy">Sort By</Label>
              <Select value={filters.sortBy} onValueChange={(value) => updateFilter('sortBy', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subscriber_count">Subscribers</SelectItem>
                  <SelectItem value="video_count">Video Count</SelectItem>
                  <SelectItem value="relevance_score">Relevance Score</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="sortOrder">Order</Label>
              <Select value={filters.sortOrder} onValueChange={(value) => updateFilter('sortOrder', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Highest First</SelectItem>
                  <SelectItem value="asc">Lowest First</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="minSubscribers">Min Subscribers</Label>
              <Select value={filters.minSubscribers.toString()} onValueChange={(value) => updateFilter('minSubscribers', parseInt(value))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">All</SelectItem>
                  <SelectItem value="1000">1K+</SelectItem>
                  <SelectItem value="10000">10K+</SelectItem>
                  <SelectItem value="100000">100K+</SelectItem>
                  <SelectItem value="1000000">1M+</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="minVideos">Min Videos</Label>
              <Select value={filters.minVideos.toString()} onValueChange={(value) => updateFilter('minVideos', parseInt(value))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1+</SelectItem>
                  <SelectItem value="10">10+</SelectItem>
                  <SelectItem value="50">50+</SelectItem>
                  <SelectItem value="100">100+</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="limit">Show</Label>
              <Select value={filters.limit.toString()} onValueChange={(value) => updateFilter('limit', parseInt(value))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 channels</SelectItem>
                  <SelectItem value="25">25 channels</SelectItem>
                  <SelectItem value="50">50 channels</SelectItem>
                  <SelectItem value="100">100 channels</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Review Queue */}
      <Card>
        <CardHeader>
          <CardTitle>Pending Review Queue ({channels.length} channels)</CardTitle>
          <CardDescription>High-quality channels sorted by {filters.sortBy.replace('_', ' ')}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded-lg animate-pulse">
                  <div className="flex-1">
                    <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="h-6 bg-gray-200 rounded w-16"></div>
                    <div className="h-8 bg-gray-200 rounded w-20"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : channels.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No channels found matching the current filters
            </div>
          ) : (
            <div className="space-y-4">
              {channels.map((channel) => {
                const subTier = getSubscriberTier(channel.subscriber_count);
                return (
                  <div key={channel.discovered_channel_id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-medium">{channel.channel_title}</h3>
                        <Badge className={subTier.color}>{subTier.tier}</Badge>
                        <Badge className={getRelevanceColor(channel.relevance_score)}>
                          Score: {channel.relevance_score}
                        </Badge>
                        {channel.discovery_count > 1 && (
                          <Badge variant="outline" className="text-blue-600">
                            {channel.discovery_count}x found
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {channel.subscriber_count?.toLocaleString()} subs
                        </span>
                        <span className="flex items-center gap-1">
                          <Video className="h-3 w-3" />
                          {channel.video_count} videos
                        </span>
                        <span className="flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" />
                          via {channel.discovery_methods}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(`https://youtube.com/channel/${channel.discovered_channel_id}`, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-600 hover:bg-green-50"
                        onClick={() => handleChannelAction(channel.discovered_channel_id, 'approve')}
                        disabled={isProcessing === channel.discovered_channel_id}
                      >
                        <ThumbsUp className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => handleChannelAction(channel.discovered_channel_id, 'reject')}
                        disabled={isProcessing === channel.discovered_channel_id}
                      >
                        <ThumbsDown className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}