'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { ImportModal } from './import-modal';
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
  CheckSquare,
  AlertTriangle,
  Database,
  ChevronLeft,
  ChevronRight
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
  // Duplicate checking fields
  isImported?: boolean;
  inQueue?: boolean;
  importedVideoCount?: number;
  lastImportDate?: string | null;
}

interface ApiResponse {
  success: boolean;
  channels: DiscoveredChannel[];
  summary?: any;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: any;
}

// Custom hook for debounced values
function useDebounced<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function UnifiedReviewQueueOptimized() {
  const [channels, setChannels] = useState<DiscoveredChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [methodFilter, setMethodFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [sortBy, setSortBy] = useState('discovery_date');
  const [selectedChannelIds, setSelectedChannelIds] = useState<Set<string>>(new Set());
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [subscriberRange, setSubscriberRange] = useState({ min: '10000', max: '' });
  const [videoCountRange, setVideoCountRange] = useState({ min: '', max: '' });
  const [duplicateStats, setDuplicateStats] = useState<{
    alreadyImported: number;
    inQueue: number;
    newChannels: number;
  } | null>(null);
  const [duplicateFilter, setDuplicateFilter] = useState<'all' | 'new' | 'imported' | 'queued'>('all');
  const [showImportModal, setShowImportModal] = useState(false);
  const [channelsForImport, setChannelsForImport] = useState<DiscoveredChannel[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });

  // Debounce search term to avoid excessive API calls
  const debouncedSearchTerm = useDebounced(searchTerm, 300);
  const debouncedSubscriberMin = useDebounced(subscriberRange.min, 500);
  const debouncedSubscriberMax = useDebounced(subscriberRange.max, 500);
  const debouncedVideoMin = useDebounced(videoCountRange.min, 500);
  const debouncedVideoMax = useDebounced(videoCountRange.max, 500);

  // Load channels with all filters applied server-side
  const loadChannels = useCallback(async (page: number = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        sortBy,
        sortOrder: 'desc',
        page: page.toString(),
        limit: pagination.limit.toString()
      });

      if (methodFilter !== 'all') {
        params.set('method', methodFilter);
      }
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (debouncedSearchTerm.trim()) {
        params.set('search', debouncedSearchTerm.trim());
      }
      if (debouncedSubscriberMin) {
        params.set('minSubscribers', debouncedSubscriberMin);
      }
      if (debouncedSubscriberMax) {
        params.set('maxSubscribers', debouncedSubscriberMax);
      }
      if (debouncedVideoMin) {
        params.set('minVideos', debouncedVideoMin);
      }
      if (debouncedVideoMax) {
        params.set('maxVideos', debouncedVideoMax);
      }

      const response = await fetch(`/api/youtube/discovery/unified-queue?${params}`);
      if (response.ok) {
        const data: ApiResponse = await response.json();
        setChannels(data.channels || []);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Error loading channels:', error);
    } finally {
      setLoading(false);
    }
  }, [methodFilter, statusFilter, sortBy, debouncedSearchTerm, debouncedSubscriberMin, debouncedSubscriberMax, debouncedVideoMin, debouncedVideoMax, pagination.limit]);

  // Reset to page 1 when filters change
  useEffect(() => {
    loadChannels(1);
  }, [methodFilter, statusFilter, sortBy, debouncedSearchTerm, debouncedSubscriberMin, debouncedSubscriberMax, debouncedVideoMin, debouncedVideoMax]);

  // Clear selections when filters change
  useEffect(() => {
    setSelectedChannelIds(new Set());
  }, [methodFilter, statusFilter]);

  const handleSelectChannel = useCallback((channelId: string) => {
    setSelectedChannelIds(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(channelId)) {
        newSelection.delete(channelId);
      } else {
        newSelection.add(channelId);
      }
      return newSelection;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const pendingChannels = channels.filter(ch => ch.validation_status === 'pending');
    setSelectedChannelIds(prev => {
      if (prev.size === pendingChannels.length) {
        // All selected, so deselect all
        return new Set();
      } else {
        // Select all pending channels
        return new Set(pendingChannels.map(ch => ch.discovered_channel_id));
      }
    });
  }, [channels]);

  const checkForDuplicates = async () => {
    setCheckingDuplicates(true);
    try {
      const channelIds = channels.map(ch => ch.discovered_channel_id);
      
      if (channelIds.length === 0) {
        return;
      }

      const response = await fetch('/api/youtube/discovery/check-duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelIds })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Update channels with duplicate info
        const updatedChannels = channels.map(channel => {
          const duplicateInfo = data.duplicates[channel.discovered_channel_id];
          if (duplicateInfo) {
            return {
              ...channel,
              isImported: duplicateInfo.isImported,
              inQueue: duplicateInfo.inQueue,
              importedVideoCount: duplicateInfo.videoCount,
              lastImportDate: duplicateInfo.lastImportDate
            };
          }
          return channel;
        });
        
        setChannels(updatedChannels);
        setDuplicateStats(data.stats);
        
        console.log(`✅ Duplicate check complete: ${data.stats.alreadyImported} imported, ${data.stats.inQueue} in queue, ${data.stats.newChannels} new`);
      }
    } catch (error) {
      console.error('Error checking duplicates:', error);
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const updateChannelStatus = async (channelId: string, action: 'approve' | 'reject', autoImport: boolean = false) => {
    if (action === 'reject') {
      // For reject: Remove from UI immediately (channel slides away)
      setChannels(prevChannels => 
        prevChannels.filter(channel => channel.discovered_channel_id !== channelId)
      );
    } else {
      // For approve: Update status (show approved badge)
      setChannels(prevChannels => 
        prevChannels.map(channel => 
          channel.discovered_channel_id === channelId 
            ? { ...channel, validation_status: 'approved' }
            : channel
        )
      );
    }

    try {
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
          } else {
            console.error('Import failed:', result.importResults.error);
          }
        }
        console.log(`✅ Channel ${channelId} ${action}d successfully`);
      }
    } catch (error) {
      console.error('Error updating channel status:', error);
      // Revert optimistic update on error by reloading current page
      loadChannels(pagination.page);
    }
  };

  const bulkAction = async (action: 'approve' | 'reject', channelIds: string[], autoImport: boolean = false) => {
    if (action === 'approve' && autoImport) {
      const selectedChannels = channels.filter(ch => channelIds.includes(ch.discovered_channel_id));
      setChannelsForImport(selectedChannels);
      setShowImportModal(true);
      return;
    }

    if (action === 'reject') {
      // For bulk reject: Remove all rejected channels from UI immediately
      setChannels(prevChannels =>
        prevChannels.filter(channel => !channelIds.includes(channel.discovered_channel_id))
      );
    } else {
      // For bulk approve: Update status to show approved badges
      setChannels(prevChannels =>
        prevChannels.map(channel =>
          channelIds.includes(channel.discovered_channel_id)
            ? { ...channel, validation_status: 'approved' }
            : channel
        )
      );
    }

    // Clear selections immediately for better UX
    setSelectedChannelIds(new Set());

    try {
      const response = await fetch('/api/youtube/discovery/bulk-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelIds,
          action,
          autoImport: false
        })
      });

      if (response.ok) {
        console.log(`✅ Bulk ${action} completed for ${channelIds.length} channels`);
      }
    } catch (error) {
      console.error('Error performing bulk action:', error);
      // Revert optimistic update on error by reloading current page
      loadChannels(pagination.page);
    }
  };

  const handleImportWithFilter = async (settings: { 
    channelIds: string[], 
    dateFilter: 'all' | 'recent',
    dateRange: number 
  }) => {
    // Optimistic update - approve channels and mark as imported
    setChannels(prevChannels =>
      prevChannels.map(channel =>
        settings.channelIds.includes(channel.discovered_channel_id)
          ? { ...channel, validation_status: 'imported' }
          : channel
      )
    );

    // Clear selections immediately
    setSelectedChannelIds(new Set());

    try {
      await fetch('/api/youtube/discovery/bulk-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelIds: settings.channelIds,
          action: 'approve',
          autoImport: false
        })
      });

      const response = await fetch('/api/video-import/unified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'discovery',
          channelIds: settings.channelIds,
          options: {
            dateFilter: settings.dateFilter,
            dateRange: settings.dateRange,
            batchSize: 50
          }
        })
      });

      if (response.ok) {
        console.log(`✅ Import job created for ${settings.channelIds.length} channels with ${settings.dateFilter} filter`);
        // Don't reload - optimistic update already applied
      }
    } catch (error) {
      console.error('Error importing channels:', error);
      // Revert optimistic update on error by reloading current page
      loadChannels(pagination.page);
    }
  };

  // Memoized utilities
  const formatNumber = useCallback((num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  }, []);

  const getMethodBadgeColor = useCallback((method: string) => {
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
  }, []);

  const getMethodDisplayName = useCallback((method: string, context: any) => {
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
  }, []);

  // Pagination handlers
  const goToPage = useCallback((page: number) => {
    loadChannels(page);
  }, [loadChannels]);

  const goToPreviousPage = useCallback(() => {
    if (pagination.page > 1) {
      goToPage(pagination.page - 1);
    }
  }, [pagination.page, goToPage]);

  const goToNextPage = useCallback(() => {
    if (pagination.page < pagination.totalPages) {
      goToPage(pagination.page + 1);
    }
  }, [pagination.page, pagination.totalPages, goToPage]);

  // Memoized pending channels for select all functionality
  const pendingChannels = useMemo(() => {
    return channels.filter(ch => ch.validation_status === 'pending');
  }, [channels]);

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
          <div className="flex items-center justify-between">
            <CardTitle>Filters & Search</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={checkForDuplicates}
              disabled={checkingDuplicates || channels.length === 0}
            >
              {checkingDuplicates ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <Database className="h-4 w-4 mr-2" />
                  Check for Duplicates
                </>
              )}
            </Button>
          </div>
          {duplicateStats && (
            <div className="flex gap-4 mt-2 text-sm">
              <span className="text-orange-600">
                <AlertTriangle className="h-4 w-4 inline mr-1" />
                {duplicateStats.alreadyImported} Already Imported
              </span>
              <span className="text-yellow-600">
                <Clock className="h-4 w-4 inline mr-1" />
                {duplicateStats.inQueue} In Queue
              </span>
              <span className="text-green-600">
                <CheckCircle className="h-4 w-4 inline mr-1" />
                {duplicateStats.newChannels} New Channels
              </span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
              <label className="text-sm font-medium">Import Status</label>
              <Select value={duplicateFilter} onValueChange={(value: 'all' | 'new' | 'imported' | 'queued') => setDuplicateFilter(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Channels</SelectItem>
                  <SelectItem value="new">New Only</SelectItem>
                  <SelectItem value="imported">Already Imported</SelectItem>
                  <SelectItem value="queued">In Queue</SelectItem>
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

          {/* Row for subscriber and video count filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Subscriber Range</label>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  placeholder="Min"
                  value={subscriberRange.min}
                  onChange={(e) => setSubscriberRange({ ...subscriberRange, min: e.target.value })}
                  className="w-full"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="number"
                  placeholder="Max"
                  value={subscriberRange.max}
                  onChange={(e) => setSubscriberRange({ ...subscriberRange, max: e.target.value })}
                  className="w-full"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Video Count Range</label>
              <div className="flex gap-2 items-center">
                <Input
                  type="number"
                  placeholder="Min"
                  value={videoCountRange.min}
                  onChange={(e) => setVideoCountRange({ ...videoCountRange, min: e.target.value })}
                  className="w-full"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="number"
                  placeholder="Max"
                  value={videoCountRange.max}
                  onChange={(e) => setVideoCountRange({ ...videoCountRange, max: e.target.value })}
                  className="w-full"
                />
              </div>
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Discovered Channels</CardTitle>
              <CardDescription>
                Showing {channels.length} of {pagination.total} channels
              </CardDescription>
            </div>
            
            {/* Pagination Controls */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goToPreviousPage}
                  disabled={pagination.page <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goToNextPage}
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No channels found matching your criteria.
            </div>
          ) : (
            <div className="space-y-4">
              {channels.map((channel) => (
                <div
                  key={channel.id}
                  className="flex items-center justify-between p-4 border rounded-lg transition-all duration-300 ease-in-out"
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
                      
                      {/* Duplicate status badges */}
                      {channel.isImported && (
                        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300">
                          <Database className="h-3 w-3 mr-1" />
                          Already Imported ({channel.importedVideoCount || 0} videos)
                        </Badge>
                      )}
                      {channel.inQueue && (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
                          <Clock className="h-3 w-3 mr-1" />
                          In Queue
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        {formatNumber(channel.subscriber_count || 0)} subscribers
                      </div>
                      <div className="flex items-center gap-1">
                        <Play className="h-4 w-4" />
                        {formatNumber(channel.video_count || 0)} videos
                        <span className="text-xs text-muted-foreground ml-1">
                          (filter available)
                        </span>
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
                      {channel.lastImportDate && (
                        <div className="text-xs text-orange-600">
                          Last imported: {new Date(channel.lastImportDate).toLocaleDateString()}
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
      
      {/* Import Modal */}
      <ImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        channels={channelsForImport}
        onImport={handleImportWithFilter}
      />
    </div>
  );
}