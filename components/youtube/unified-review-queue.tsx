'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Users, 
  Play, 
  CheckCircle, 
  Clock, 
  X, 
  ExternalLink,
  RefreshCw,
  Search,
  Filter,
  Upload,
  Square,
  CheckSquare
} from 'lucide-react';

interface DiscoveredChannel {
  id: string;
  discovered_channel_id: string;
  channel_metadata: {
    title: string;
    description?: string;
    subscriber_count?: number;
    video_count?: number;
    thumbnail_url?: string;
  };
  discovery_method: string;
  discovery_date: string;
  validation_status: 'pending' | 'approved' | 'rejected' | 'imported';
  relevance_score: number;
  subscriber_count: number;
  video_count: number;
}

export function UnifiedReviewQueue() {
  const [channels, setChannels] = useState<DiscoveredChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [sortBy, setSortBy] = useState('relevance_score');
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadChannels();
  }, [methodFilter, statusFilter, sortBy]);

  // Clear selections when filters change
  useEffect(() => {
    setSelectedChannelIds(new Set());
  }, [methodFilter, statusFilter]);

  const handleSelectChannel = (channelId: string) => {
    const newSelection = new Set(selectedChannelIds);
    if (newSelection.has(channelId)) {
      newSelection.delete(channelId);
    } else {
      newSelection.add(channelId);
    }
    setSelectedChannelIds(newSelection);
  };

  const handleSelectAll = () => {
    const pendingChannels = filteredChannels.filter(ch => ch.validation_status === 'pending');
    if (selectedChannelIds.size === pendingChannels.length) {
      // All selected, so deselect all
      setSelectedChannelIds(new Set());
    } else {
      // Select all pending channels
      const allIds = new Set(pendingChannels.map(ch => ch.discovered_channel_id));
      setSelectedChannelIds(allIds);
    }
  };

  const loadChannels = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        sortBy,
        sortOrder: 'desc',
        limit: '1000'  // Load all channels
      });

      if (methodFilter !== 'all') {
        params.set('method', methodFilter);
      }
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }

      const response = await fetch(`/api/youtube/discovery/unified-queue?${params}`);
      if (response.ok) {
        const data = await response.json();
        setChannels(data.channels || []);
      }
    } catch (error) {
      console.error('Error loading channels:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateChannelStatus = async (channelId: string, action: 'approve' | 'reject', autoImport: boolean = false) => {
    try {
      // Use bulk validate endpoint for single channel
      const response = await fetch('/api/youtube/discovery/bulk-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelIds: [channelId],
          action,
          autoImport
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (autoImport && result.importResults) {
          if (result.importResults.success) {
            console.log(`✅ Import job created: ${result.importResults.jobId}`);
            // Could show a toast notification here
          } else {
            console.error('Import failed:', result.importResults.error);
            // Could show an error notification here
          }
        }
        loadChannels();
      }
    } catch (error) {
      console.error('Error updating channel status:', error);
    }
  };

  const bulkAction = async (action: 'approve' | 'reject', channelIds: string[], autoImport: boolean = false) => {
    try {
      const response = await fetch('/api/youtube/discovery/bulk-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelIds,
          action,
          autoImport
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (autoImport && result.importResults) {
          if (result.importResults.success) {
            console.log(`✅ Bulk import job created: ${result.importResults.jobId} for ${channelIds.length} channels`);
            // Could show a toast notification here
          } else {
            console.error('Bulk import failed:', result.importResults.error);
            // Could show an error notification here
          }
        }
        
        // Clear selections after successful bulk action
        setSelectedChannelIds(new Set());
        loadChannels();
      }
    } catch (error) {
      console.error('Error performing bulk action:', error);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getMethodBadgeColor = (method: string) => {
    switch (method) {
      case 'search': return 'bg-blue-100 text-blue-800';
      case 'featured': return 'bg-green-100 text-green-800';
      case 'shelves': return 'bg-purple-100 text-purple-800';
      case 'comment': return 'bg-orange-100 text-orange-800';
      case 'subscriptions': return 'bg-red-100 text-red-800';
      case 'collaborations': return 'bg-yellow-100 text-yellow-800';
      case 'playlist': return 'bg-indigo-100 text-indigo-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getMethodDisplayName = (method: string, context: any) => {
    if (method === 'search' && context?.discovery_method === 'google_pse') {
      return 'Google PSE';
    }
    switch (method) {
      case 'search': return 'Search';
      case 'featured': return 'Featured';
      case 'shelves': return 'Shelves';
      case 'comment': return 'Comment';
      case 'subscriptions': return 'Subscriptions';
      case 'collaborations': return 'Collaborations';
      case 'playlist': return 'Playlist';
      default: return method;
    }
  };

  const filteredChannels = channels.filter(channel => {
    const matchesSearch = !searchTerm || 
      channel.channel_metadata?.title?.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const pendingChannels = filteredChannels.filter(ch => ch.validation_status === 'pending');
  const hasSelectedChannels = selectedChannelIds.size > 0;

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-8 w-8 animate-spin" />
            <span className="ml-2">Loading review queue...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Filters & Search</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Search</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search channels..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Discovery Method</label>
              <Select value={methodFilter} onValueChange={setMethodFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Methods</SelectItem>
                  <SelectItem value="search">Google PSE (Search)</SelectItem>
                  <SelectItem value="featured">Featured Channels</SelectItem>
                  <SelectItem value="shelves">Channel Shelves</SelectItem>
                  <SelectItem value="comment">Comments</SelectItem>
                  <SelectItem value="subscriptions">Subscriptions</SelectItem>
                  <SelectItem value="collaborations">Collaborations</SelectItem>
                  <SelectItem value="playlist">Playlists</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="imported">Imported</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Sort By</label>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="relevance_score">Relevance Score</SelectItem>
                  <SelectItem value="subscriber_count">Subscribers</SelectItem>
                  <SelectItem value="video_count">Video Count</SelectItem>
                  <SelectItem value="discovery_date">Discovery Date</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {statusFilter === 'pending' && pendingChannels.length > 0 && (
            <div className="flex flex-col gap-2 mt-4 pt-4 border-t">
              {/* Select All Checkbox */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="select-all"
                  checked={selectedChannelIds.size === pendingChannels.length && pendingChannels.length > 0}
                  onCheckedChange={handleSelectAll}
                />
                <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
                  Select All ({pendingChannels.length} channels)
                </label>
              </div>

              {/* Batch Action Buttons */}
              {hasSelectedChannels && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => bulkAction('approve', Array.from(selectedChannelIds))}
                    className="text-green-600"
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Approve Selected ({selectedChannelIds.size})
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => bulkAction('approve', Array.from(selectedChannelIds), true)}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <Upload className="h-4 w-4 mr-1" />
                    Batch Import Selected ({selectedChannelIds.size})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => bulkAction('reject', Array.from(selectedChannelIds))}
                    className="text-red-600"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Reject Selected ({selectedChannelIds.size})
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Channel List */}
      <Card>
        <CardHeader>
          <CardTitle>Discovered Channels</CardTitle>
          <CardDescription>
            {filteredChannels.length} channels found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredChannels.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No channels found matching your criteria.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredChannels.map((channel) => (
                <div
                  key={channel.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  {/* Checkbox for pending channels or spacer for others */}
                  <div className="mr-3 w-5 flex justify-center">
                    {channel.validation_status === 'pending' && (
                      <Checkbox
                        checked={selectedChannelIds.has(channel.discovered_channel_id)}
                        onCheckedChange={() => handleSelectChannel(channel.discovered_channel_id)}
                      />
                    )}
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold">{channel.channel_metadata?.title || 'Unknown Channel'}</h3>
                      <Badge 
                        variant="secondary"
                        className={getMethodBadgeColor(channel.discovery_method)}
                      >
                        {getMethodDisplayName(channel.discovery_method, channel.discovery_context)}
                      </Badge>
                      <Badge variant={
                        channel.validation_status === 'pending' ? 'secondary' :
                        channel.validation_status === 'approved' ? 'default' :
                        channel.validation_status === 'imported' ? 'default' : 'destructive'
                      }>
                        {channel.validation_status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        {formatNumber(channel.subscriber_count || 0)} subscribers
                      </div>
                      <div className="flex items-center gap-1">
                        <Play className="h-4 w-4" />
                        {formatNumber(channel.video_count || 0)} videos
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {new Date(channel.discovery_date).toLocaleDateString()}
                      </div>
                      {channel.relevance_score > 0 && (
                        <div className="text-xs">
                          Score: {channel.relevance_score.toFixed(1)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(`https://youtube.com/channel/${channel.discovered_channel_id}`, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>

                    {channel.validation_status === 'pending' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateChannelStatus(channel.discovered_channel_id, 'approve')}
                          className="text-green-600 hover:text-green-700"
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Approve
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => updateChannelStatus(channel.discovered_channel_id, 'approve', true)}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          <Upload className="h-4 w-4 mr-1" />
                          Import
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateChannelStatus(channel.discovered_channel_id, 'reject')}
                          className="text-red-600 hover:text-red-700"
                        >
                          <X className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}