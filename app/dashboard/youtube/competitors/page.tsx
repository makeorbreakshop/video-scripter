'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase-client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, Plus, Search, Download, Calendar, Users, Eye, ThumbsUp, MessageCircle, Clock, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface CompetitorChannel {
  id: string;
  name: string;
  handle: string;
  subscriberCount: number;
  videoCount: number;
  lastImport: string;
  status: 'active' | 'importing' | 'failed';
  importProgress?: number;
  thumbnailUrl?: string;
}

interface SearchResult {
  channelId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount?: string;
  videoCount?: string;
  customUrl?: string;
  isAlreadyImported?: boolean;
  importSource?: 'competitor' | 'discovery' | null;
}

export default function CompetitorsPage() {
  const [channelInput, setChannelInput] = useState('');
  const [timePeriod, setTimePeriod] = useState('all');
  const [maxVideos, setMaxVideos] = useState('all');
  const [excludeShorts, setExcludeShorts] = useState(true);
  const [minViews, setMinViews] = useState('');
  const [maxViews, setMaxViews] = useState('');
  const [channelPreviewStats, setChannelPreviewStats] = useState<{videoCount: number; estimatedImport: number} | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [competitorChannels, setCompetitorChannels] = useState<CompetitorChannel[]>([]);
  const [refreshingChannels, setRefreshingChannels] = useState<Set<string>>(new Set());
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<SearchResult | null>(null);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [importedChannelIds, setImportedChannelIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  // Prevent hydration issues by only rendering after mount
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Re-trigger render when mounted to format dates properly
  useEffect(() => {
    if (isMounted && competitorChannels.length > 0) {
      // Force a re-render to update date formatting
      setCompetitorChannels([...competitorChannels]);
    }
  }, [isMounted]);

  // Load competitor channels on mount (no auth required)
  useEffect(() => {
    loadCompetitorChannels();
  }, []);

  const loadCompetitorChannels = async () => {
    try {
      const response = await fetch('/api/youtube/competitor-channels');
      if (!response.ok) {
        throw new Error('Failed to fetch competitor channels');
      }
      
      const { channels } = await response.json();

      console.log('🔍 Channels loaded from API:', channels?.length);
      console.log('🔍 Raw channel data:', channels?.[0]);
      
      // Set channels directly without date formatting initially
      const formattedChannels: CompetitorChannel[] = channels?.map(channel => ({
        ...channel,
        lastImport: channel.lastImport // Keep raw date for now
      })) || [];

      console.log('🔍 Final channels array:', formattedChannels.map(c => ({ name: c.name, lastImport: c.lastImport })));
      setCompetitorChannels(formattedChannels);
      
      // Update imported channel IDs for duplicate detection
      const importedIds = new Set(formattedChannels.map(c => c.id));
      setImportedChannelIds(importedIds);
    } catch (error) {
      console.error('Error loading competitor channels:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      toast({
        title: 'Error',
        description: 'Failed to load competitor channels',
        variant: 'destructive'
      });
    }
  };

  const formatTimeAgo = (dateString: string) => {
    if (!dateString) return 'No date';
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid date';
      // Use ISO date format for consistency
      return date.toISOString().split('T')[0];
    } catch (error) {
      return 'Invalid date';
    }
  };

  const handleSearchChannels = async () => {
    if (!channelInput.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a search term',
        variant: 'destructive'
      });
      return;
    }

    setIsSearching(true);
    setSearchResults([]);

    try {
      const response = await fetch('/api/youtube/search-channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: channelInput.trim()
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to search channels');
      }

      // Filter and sort results
      let filteredChannels = result.channels || [];
      
      // Apply subscriber count filters if specified
      if (minViews || maxViews) {
        filteredChannels = filteredChannels.filter((channel) => {
          const subscriberCount = parseInt(channel.subscriberCount || '0');
          
          if (minViews && subscriberCount < parseInt(minViews)) {
            return false;
          }
          
          if (maxViews && subscriberCount > parseInt(maxViews)) {
            return false;
          }
          
          return true;
        });
      }
      
      // Sort by subscriber count (highest first)
      const sortedChannels = filteredChannels.sort((a, b) => {
        const aCount = parseInt(a.subscriberCount || '0');
        const bCount = parseInt(b.subscriberCount || '0');
        return bCount - aCount;
      });

      // Check which channels are already in the system
      const checkResponse = await fetch('/api/youtube/check-existing-channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelIds: sortedChannels.map(c => c.channelId)
        }),
      });

      let channelsWithImportStatus = sortedChannels;
      
      if (checkResponse.ok) {
        const checkResult = await checkResponse.json();
        channelsWithImportStatus = sortedChannels.map(channel => {
          const status = checkResult.channelStatus?.find(s => s.channelId === channel.channelId);
          return {
            ...channel,
            isAlreadyImported: status?.isExisting || false,
            importSource: status?.source || null
          };
        });
      } else {
        // Fallback to local check for competitor channels only
        channelsWithImportStatus = sortedChannels.map(channel => ({
          ...channel,
          isAlreadyImported: importedChannelIds.has(channel.channelId),
          importSource: importedChannelIds.has(channel.channelId) ? 'competitor' : null
        }));
      }
      
      setSearchResults(channelsWithImportStatus);
      setShowSearchResults(true);

      if (!result.channels || result.channels.length === 0) {
        toast({
          title: 'No Results',
          description: 'No channels found for your search term',
          variant: 'default'
        });
      }

    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: 'Search Failed',
        description: (error as Error).message || 'Failed to search for channels',
        variant: 'destructive'
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectChannel = (channel: SearchResult) => {
    if (channel.isAlreadyImported) {
      const sourceMessage = channel.importSource === 'competitor' 
        ? 'is already imported as a competitor' 
        : channel.importSource === 'discovery'
        ? 'is already in your discovery system'
        : 'is already in your system';
      
      toast({
        title: 'Channel Already Imported',
        description: `${channel.title} ${sourceMessage}`,
        variant: 'destructive'
      });
      return;
    }
    
    setSelectedChannel(channel);
    setShowSearchResults(false);
    getChannelPreviewStats(channel.channelId);
    toast({
      title: 'Channel Selected',
      description: `Selected: ${channel.title}`,
      variant: 'default'
    });
  };

  const getChannelPreviewStats = async (channelId: string) => {
    try {
      const response = await fetch('/api/youtube/channel-preview-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelId,
          timePeriod,
          excludeShorts
        }),
      });

      const result = await response.json();
      if (response.ok) {
        setChannelPreviewStats(result);
      }
    } catch (error) {
      console.error('Error getting channel preview stats:', error);
    }
  };

  const handleImportChannel = async () => {
    console.log('handleImportChannel called');
    console.log('selectedChannel:', selectedChannel);
    
    if (!selectedChannel) {
      toast({
        title: 'Error',
        description: 'Please search for and select a channel first',
        variant: 'destructive'
      });
      return;
    }
    
    // No authentication required for this dev tool
    
    setIsImporting(true);
    setImportProgress(0);
    
    try {
      // Start progress simulation
      const progressInterval = setInterval(() => {
        setImportProgress(prev => Math.min(prev + 5, 90));
      }, 200);

      const response = await fetch('/api/youtube/import-competitor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelId: selectedChannel.channelId,
          channelName: selectedChannel.title,
          timePeriod,
          maxVideos,
          excludeShorts,
          userId: '00000000-0000-0000-0000-000000000000'
        }),
      });

      clearInterval(progressInterval);
      setImportProgress(100);

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to import channel');
      }

      toast({
        title: 'Success!',
        description: result.message || `Imported ${result.imported_videos} videos`,
      });

      // Reset form and reload channels
      setChannelInput('');
      setSelectedChannel(null);
      setShowSearchResults(false);
      setSearchResults([]);
      await loadCompetitorChannels();

    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: 'Import Failed',
        description: (error as Error).message || 'Failed to import competitor channel',
        variant: 'destructive'
      });
    } finally {
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const handleRefreshChannel = async (channel: CompetitorChannel) => {
    const channelId = channel.id;
    
    // Add to refreshing set
    setRefreshingChannels(prev => new Set(prev).add(channelId));
    
    try {
      const response = await fetch('/api/youtube/refresh-competitor-channel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelName: channel.name,
          youtubeChannelId: channel.id,
          userId: '00000000-0000-0000-0000-000000000000'
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to refresh channel');
      }

      toast({
        title: 'Success!',
        description: result.message || `Imported ${result.videos_imported} new videos from ${channel.name}`,
      });

      // Reload channels to show updated counts
      await loadCompetitorChannels();

    } catch (error) {
      console.error('Refresh error:', error);
      toast({
        title: 'Refresh Failed',
        description: (error as Error).message || `Failed to refresh ${channel.name}`,
        variant: 'destructive'
      });
    } finally {
      // Remove from refreshing set
      setRefreshingChannels(prev => {
        const newSet = new Set(prev);
        newSet.delete(channelId);
        return newSet;
      });
    }
  };

  // Prevent hydration mismatch by waiting for client-side mount
  if (!isMounted) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Competitor Analysis</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      <Tabs defaultValue="import" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="import">Import Channel</TabsTrigger>
          <TabsTrigger value="channels">Manage Channels</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
        </TabsList>

        {/* Import Tab */}
        <TabsContent value="import" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Import Competitor Channel
              </CardTitle>
              <CardDescription>
                Add a competitor channel to analyze their content strategy and performance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Channel Search */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="channel-input">Search for Channel</Label>
                  <div className="flex gap-2">
                    <Input
                      id="channel-input"
                      placeholder="Search by channel name, @handle, or keyword..."
                      value={channelInput}
                      onChange={(e) => setChannelInput(e.target.value)}
                      disabled={isImporting || isSearching}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchChannels()}
                      className="flex-1"
                    />
                    <Button 
                      onClick={handleSearchChannels}
                      disabled={!channelInput.trim() || isSearching || isImporting}
                      variant="outline"
                    >
                      {isSearching ? (
                        <>
                          <Search className="mr-2 h-4 w-4 animate-spin" />
                          Searching...
                        </>
                      ) : (
                        <>
                          <Search className="mr-2 h-4 w-4" />
                          Search
                        </>
                      )}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Search for YouTube channels by name, handle (@username), or keywords
                  </p>
                </div>

                {/* Subscriber Count Filter */}
                <div className="space-y-2">
                  <Label>Subscriber Count Range</Label>
                  <div className="flex gap-2 items-center">
                    <Input
                      placeholder="Min subscribers (e.g. 10000)"
                      value={minViews}
                      onChange={(e) => setMinViews(e.target.value)}
                      type="number"
                      className="flex-1"
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      placeholder="Max subscribers (e.g. 1000000)"
                      value={maxViews}
                      onChange={(e) => setMaxViews(e.target.value)}
                      type="number"
                      className="flex-1"
                    />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Filter results by subscriber count range (leave empty for no limit)
                  </p>
                </div>

                {/* Selected Channel Display */}
                {selectedChannel && (
                  <div className="p-4 border rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <img 
                        src={selectedChannel.thumbnailUrl} 
                        alt={selectedChannel.title}
                        className="w-12 h-12 rounded-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" fill="%23f3f4f6"/><text x="24" y="30" text-anchor="middle" fill="%236b7280" font-family="system-ui" font-size="16">${selectedChannel.title.charAt(0)}</text></svg>`;
                        }}
                      />
                      <div className="flex-1">
                        <h4 className="font-semibold">{selectedChannel.title}</h4>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {selectedChannel.description}
                        </p>
                        {selectedChannel.subscriberCount && (
                          <p className="text-sm text-muted-foreground">
                            {formatNumber(parseInt(selectedChannel.subscriberCount))} subscribers
                          </p>
                        )}
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => {
                          setSelectedChannel(null);
                          setShowSearchResults(true);
                        }}
                      >
                        Change
                      </Button>
                    </div>
                  </div>
                )}

                {/* Search Results */}
                {showSearchResults && searchResults.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium">Search Results</h4>
                    <div className="max-h-64 overflow-y-auto space-y-2">
                      {searchResults.map((channel) => (
                        <div 
                          key={channel.channelId}
                          className={`p-3 border rounded-lg transition-colors ${
                            channel.isAlreadyImported 
                              ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800' 
                              : 'hover:bg-muted/50 cursor-pointer'
                          }`}
                          onClick={() => handleSelectChannel(channel)}
                        >
                          <div className="flex items-center gap-3">
                            <img 
                              src={channel.thumbnailUrl} 
                              alt={channel.title}
                              className="w-10 h-10 rounded-full object-cover"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="%23ef4444" rx="20"/><text x="20" y="26" text-anchor="middle" fill="white" font-family="system-ui" font-size="16" font-weight="600">${channel.title.charAt(0).toUpperCase()}</text></svg>`;
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h5 className="font-medium truncate">{channel.title}</h5>
                                {channel.isAlreadyImported && (
                                  <Badge variant="secondary" className="text-xs">
                                    {channel.importSource === 'competitor' ? 'Competitor imported' : 
                                     channel.importSource === 'discovery' ? 'In discovery' : 
                                     'Already imported'}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-1">
                                {channel.description}
                              </p>
                              {channel.subscriberCount && (
                                <p className="text-xs text-muted-foreground">
                                  {formatNumber(parseInt(channel.subscriberCount))} subscribers
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Channel Preview Stats */}
              {selectedChannel && channelPreviewStats && (
                <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-950/50">
                  <h4 className="font-medium mb-2">Import Preview</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Total videos on channel:</span>
                      <p className="font-medium">{formatNumber(channelPreviewStats.videoCount)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Videos to import:</span>
                      <p className="font-medium text-blue-600 dark:text-blue-400">
                        ~{formatNumber(channelPreviewStats.estimatedImport)}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Based on {timePeriod === 'all' ? 'entire channel history' : `last ${timePeriod} days`}
                    {excludeShorts ? ' (excluding Shorts)' : ' (including Shorts)'}
                  </p>
                </div>
              )}

              {/* Import Settings */}
              <div className="space-y-4">
                
                {/* Shorts Filter */}
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="space-y-1">
                    <Label htmlFor="exclude-shorts" className="font-medium">Filter Content Type</Label>
                    <p className="text-sm text-muted-foreground">
                      Exclude YouTube Shorts (videos under 60 seconds) from import
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      id="exclude-shorts"
                      type="checkbox"
                      checked={excludeShorts}
                      onChange={(e) => {
                        setExcludeShorts(e.target.checked);
                        if (selectedChannel) {
                          getChannelPreviewStats(selectedChannel.channelId);
                        }
                      }}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                    />
                    <Label htmlFor="exclude-shorts" className="text-sm font-medium">
                      Exclude Shorts
                    </Label>
                  </div>
                </div>
              </div>

              {/* Import Warning */}
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Note:</strong> Competitor analysis uses public YouTube data only. 
                  Private analytics (revenue, detailed demographics) are not available for competitor channels.
                </AlertDescription>
              </Alert>

              {/* Import Progress */}
              {isImporting && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Importing videos...</span>
                    <span className="text-sm text-muted-foreground">{importProgress}%</span>
                  </div>
                  <Progress value={importProgress} className="w-full" />
                  <p className="text-sm text-muted-foreground">
                    Processing video metadata and calculating performance metrics
                  </p>
                </div>
              )}

              {/* Import Button */}
              <Button 
                onClick={handleImportChannel}
                disabled={!selectedChannel || isImporting}
                className="w-full"
              >
                {isImporting ? (
                  <>
                    <Download className="mr-2 h-4 w-4 animate-spin" />
                    Importing Channel...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Import Channel
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Manage Channels Tab */}
        <TabsContent value="channels" className="space-y-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Imported Channels</h2>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => loadCompetitorChannels()}
              disabled={isImporting}
            >
              <Download className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
          <div className="grid gap-4">
            {competitorChannels.map((channel) => (
              <Card key={channel.id}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {channel.thumbnailUrl ? (
                        <img 
                          src={channel.thumbnailUrl} 
                          alt={channel.name}
                          className="h-12 w-12 rounded-full object-cover"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            console.log('Thumbnail failed to load for:', channel.name, 'URL:', channel.thumbnailUrl);
                            target.src = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" fill="%23ef4444" rx="24"/><text x="24" y="30" text-anchor="middle" fill="white" font-family="system-ui" font-size="16" font-weight="600">${channel.name.charAt(0).toUpperCase()}</text></svg>`;
                          }}
                        />
                      ) : (
                        <div className="h-12 w-12 bg-muted rounded-full flex items-center justify-center">
                          <Users className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{channel.name}</h3>
                          <Badge variant={channel.status === 'active' ? 'default' : 'secondary'}>
                            {channel.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{channel.handle}</p>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {formatNumber(channel.subscriberCount)} subscribers
                          </span>
                          <span className="flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {channel.videoCount} videos imported
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Imported: {formatTimeAgo(channel.lastImport)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleRefreshChannel(channel)}
                        disabled={refreshingChannels.has(channel.id)}
                      >
                        <Download className={`h-4 w-4 mr-2 ${refreshingChannels.has(channel.id) ? 'animate-spin' : ''}`} />
                        {refreshingChannels.has(channel.id) ? 'Refreshing...' : 'Refresh'}
                      </Button>
                      <Button variant="outline" size="sm">
                        <Search className="h-4 w-4 mr-2" />
                        Analyze
                      </Button>
                      <Button variant="outline" size="sm">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {competitorChannels.length === 0 && (
              <Card>
                <CardContent className="p-12 text-center">
                  <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">No competitor channels imported</h3>
                  <p className="text-muted-foreground mb-4">
                    Import your first competitor channel to start analyzing their content strategy
                  </p>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Import Channel
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Analysis Tab */}
        <TabsContent value="analysis" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Performance Comparison */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Performance Comparison</CardTitle>
                <CardDescription>
                  Compare top performing videos across channels
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Import competitor channels to see performance comparisons
                </p>
              </CardContent>
            </Card>

            {/* Content Gaps */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Content Opportunities</CardTitle>
                <CardDescription>
                  Topics your competitors cover that you don't
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Analysis will appear after importing competitor data
                </p>
              </CardContent>
            </Card>

            {/* Trending Topics */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Trending Topics</CardTitle>
                <CardDescription>
                  Popular topics across competitor channels
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Trending analysis requires competitor data
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Analysis Table */}
          <Card>
            <CardHeader>
              <CardTitle>Detailed Analysis</CardTitle>
              <CardDescription>
                Compare metrics and identify opportunities across all competitor channels
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-12">
                <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-semibold mb-2">No analysis data available</h3>
                <p className="text-muted-foreground">
                  Import competitor channels to generate detailed analysis and insights
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}