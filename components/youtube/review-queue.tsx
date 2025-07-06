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
  Filter,
  Search,
  Star,
  CheckCircle2
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
    if (count >= 10000000) return { tier: '10M+', color: 'bg-purple-500 text-white', ring: 'ring-purple-500/20' };
    if (count >= 1000000) return { tier: '1M+', color: 'bg-blue-500 text-white', ring: 'ring-blue-500/20' };
    if (count >= 100000) return { tier: '100K+', color: 'bg-green-500 text-white', ring: 'ring-green-500/20' };
    if (count >= 10000) return { tier: '10K+', color: 'bg-yellow-500 text-white', ring: 'ring-yellow-500/20' };
    return { tier: '<10K', color: 'bg-gray-500 text-white', ring: 'ring-gray-500/20' };
  };

  const getRelevanceColor = (score: number) => {
    if (score >= 30) return 'bg-red-500 text-white';
    if (score >= 20) return 'bg-orange-500 text-white';
    if (score >= 10) return 'bg-blue-500 text-white';
    return 'bg-gray-500 text-white';
  };

  const getQualityScore = (channel: ReviewChannel) => {
    if (channel.subscriber_count >= 1000000 && channel.video_count >= 100) return 'premium';
    if (channel.subscriber_count >= 100000 && channel.video_count >= 50) return 'high';
    if (channel.subscriber_count >= 10000 && channel.video_count >= 10) return 'good';
    return 'basic';
  };

  const getQualityBadge = (quality: string) => {
    switch (quality) {
      case 'premium': return { label: 'Premium', color: 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' };
      case 'high': return { label: 'High Quality', color: 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white' };
      case 'good': return { label: 'Good', color: 'bg-gradient-to-r from-green-500 to-emerald-500 text-white' };
      default: return { label: 'Basic', color: 'bg-gray-500 text-white' };
    }
  };

  return (
    <div className="space-y-8">
      {/* Modern Filters Section */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500 rounded-lg">
              <Filter className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Filter & Sort</h3>
              <p className="text-sm text-gray-500">Customize your review queue</p>
            </div>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">Sort By</Label>
              <Select value={filters.sortBy} onValueChange={(value) => updateFilter('sortBy', value)}>
                <SelectTrigger className="bg-gray-50 border-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subscriber_count">👥 Subscribers</SelectItem>
                  <SelectItem value="video_count">🎥 Video Count</SelectItem>
                  <SelectItem value="relevance_score">⭐ Relevance Score</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">Order</Label>
              <Select value={filters.sortOrder} onValueChange={(value) => updateFilter('sortOrder', value)}>
                <SelectTrigger className="bg-gray-50 border-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">📈 Highest First</SelectItem>
                  <SelectItem value="asc">📉 Lowest First</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">Min Subscribers</Label>
              <Select value={filters.minSubscribers.toString()} onValueChange={(value) => updateFilter('minSubscribers', parseInt(value))}>
                <SelectTrigger className="bg-gray-50 border-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">All Channels</SelectItem>
                  <SelectItem value="1000">1K+ subscribers</SelectItem>
                  <SelectItem value="10000">10K+ subscribers</SelectItem>
                  <SelectItem value="100000">100K+ subscribers</SelectItem>
                  <SelectItem value="1000000">1M+ subscribers</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">Min Videos</Label>
              <Select value={filters.minVideos.toString()} onValueChange={(value) => updateFilter('minVideos', parseInt(value))}>
                <SelectTrigger className="bg-gray-50 border-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1+ videos</SelectItem>
                  <SelectItem value="10">10+ videos</SelectItem>
                  <SelectItem value="50">50+ videos</SelectItem>
                  <SelectItem value="100">100+ videos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">Show Results</Label>
              <Select value={filters.limit.toString()} onValueChange={(value) => updateFilter('limit', parseInt(value))}>
                <SelectTrigger className="bg-gray-50 border-gray-200">
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
        </div>
      </div>

      {/* Modern Review Queue */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500 rounded-lg">
                <Search className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Review Queue 
                  <span className="ml-2 px-2 py-1 text-sm bg-blue-100 text-blue-800 rounded-full">
                    {channels.length} channels
                  </span>
                </h3>
                <p className="text-sm text-gray-500">
                  High-quality channels sorted by {filters.sortBy.replace('_', ' ')}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6">
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-6 animate-pulse">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="h-6 bg-gray-200 rounded w-48"></div>
                        <div className="h-6 bg-gray-200 rounded w-16"></div>
                        <div className="h-6 bg-gray-200 rounded w-20"></div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="h-4 bg-gray-200 rounded w-24"></div>
                        <div className="h-4 bg-gray-200 rounded w-20"></div>
                        <div className="h-4 bg-gray-200 rounded w-32"></div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-9 bg-gray-200 rounded w-20"></div>
                      <div className="h-9 bg-gray-200 rounded w-24"></div>
                      <div className="h-9 bg-gray-200 rounded w-20"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : channels.length === 0 ? (
            <div className="text-center py-16">
              <div className="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <Search className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No channels found</h3>
              <p className="text-gray-500 max-w-md mx-auto">
                No channels match your current filter criteria. Try adjusting your filters or running discovery to find new channels.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {channels.map((channel) => {
                const subTier = getSubscriberTier(channel.subscriber_count);
                const quality = getQualityScore(channel);
                const qualityBadge = getQualityBadge(quality);
                
                return (
                  <div 
                    key={channel.discovered_channel_id} 
                    className="bg-gray-50 hover:bg-gray-100 transition-all duration-200 rounded-xl p-6 border border-gray-200 hover:border-gray-300 hover:shadow-md group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        {/* Channel Header */}
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="text-xl font-semibold text-gray-900 truncate group-hover:text-blue-600 transition-colors">
                            {channel.channel_title}
                          </h3>
                          <Badge className={`${qualityBadge.color} px-3 py-1 text-xs font-medium rounded-full`}>
                            {qualityBadge.label}
                          </Badge>
                          <Badge className={`${subTier.color} px-3 py-1 text-xs font-medium rounded-full`}>
                            {subTier.tier}
                          </Badge>
                        </div>

                        {/* Channel Stats */}
                        <div className="flex items-center gap-6 text-sm">
                          <div className="flex items-center gap-2 text-gray-600">
                            <div className="p-1.5 bg-blue-100 rounded-lg">
                              <Users className="h-4 w-4 text-blue-600" />
                            </div>
                            <span className="font-medium">
                              {channel.subscriber_count?.toLocaleString()} subscribers
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2 text-gray-600">
                            <div className="p-1.5 bg-green-100 rounded-lg">
                              <Video className="h-4 w-4 text-green-600" />
                            </div>
                            <span className="font-medium">
                              {channel.video_count} videos
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-gray-600">
                            <div className="p-1.5 bg-purple-100 rounded-lg">
                              <Star className="h-4 w-4 text-purple-600" />
                            </div>
                            <span className="font-medium">
                              Score: {channel.relevance_score}
                            </span>
                          </div>

                          {channel.discovery_count > 1 && (
                            <div className="flex items-center gap-2 text-orange-600">
                              <div className="p-1.5 bg-orange-100 rounded-lg">
                                <TrendingUp className="h-4 w-4" />
                              </div>
                              <span className="font-medium">
                                Found {channel.discovery_count}x
                              </span>
                            </div>
                          )}

                          <div className="text-gray-500 text-xs">
                            via {channel.discovery_methods}
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-3 ml-6">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-gray-300 hover:border-gray-400 hover:bg-gray-100"
                          onClick={() => window.open(`https://youtube.com/channel/${channel.discovered_channel_id}`, '_blank')}
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Preview
                        </Button>
                        
                        <Button
                          size="sm"
                          className="bg-green-500 hover:bg-green-600 text-white shadow-sm"
                          onClick={() => handleChannelAction(channel.discovered_channel_id, 'approve')}
                          disabled={isProcessing === channel.discovered_channel_id}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Approve
                        </Button>
                        
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
                          onClick={() => handleChannelAction(channel.discovered_channel_id, 'reject')}
                          disabled={isProcessing === channel.discovered_channel_id}
                        >
                          <ThumbsDown className="h-4 w-4 mr-2" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}