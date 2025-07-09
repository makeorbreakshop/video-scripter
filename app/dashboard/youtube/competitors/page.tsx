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
import { AlertCircle, Plus, Search, Download, Calendar, Users, Eye, ThumbsUp, MessageCircle, Clock } from 'lucide-react';
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
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [competitorChannels, setCompetitorChannels] = useState<CompetitorChannel[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<SearchResult | null>(null);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [importedChannelIds, setImportedChannelIds] = useState<Set<string>>(new Set());
  const [channelSearchTerm, setChannelSearchTerm] = useState('');
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

  const parseYouTubeChannelUrl = (input: string): { channelId?: string, username?: string, handle?: string } | null => {
    try {
      // Handle different YouTube channel URL formats
      const patterns = [
        // https://www.youtube.com/channel/CHANNEL_ID
        /youtube\.com\/channel\/([a-zA-Z0-9_-]+)/,
        // https://www.youtube.com/c/USERNAME
        /youtube\.com\/c\/([a-zA-Z0-9_-]+)/,
        // https://www.youtube.com/@HANDLE
        /youtube\.com\/@([a-zA-Z0-9_-]+)/,
        // https://www.youtube.com/user/USERNAME
        /youtube\.com\/user\/([a-zA-Z0-9_-]+)/,
        // Direct channel ID (UC...)
        /^(UC[a-zA-Z0-9_-]{22})$/
      ];

      for (const [index, pattern] of patterns.entries()) {
        const match = input.match(pattern);
        if (match) {
          const value = match[1];
          
          // Pattern 0 and 4 are channel IDs
          if (index === 0 || index === 4) {
            return { channelId: value };
          }
          // Pattern 1 is custom URL (c/username)
          else if (index === 1) {
            return { username: value };
          }
          // Pattern 2 is @handle
          else if (index === 2) {
            return { handle: value };
          }
          // Pattern 3 is user/username
          else if (index === 3) {
            return { username: value };
          }
        }
      }
    } catch (error) {
      console.error('Error parsing YouTube URL:', error);
    }
    
    return null;
  };

  const handleDirectUrlImport = async () => {
    if (!channelInput.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a YouTube channel URL',
        variant: 'destructive'
      });
      return;
    }

    // Check if it's a YouTube URL
    if (!channelInput.includes('youtube.com/')) {
      // Fall back to search functionality
      await handleSearchChannels();
      return;
    }

    setIsImporting(true);
    setImportProgress(10);

    try {
      // Step 1: Extract channel ID from URL
      const scrapeResponse = await fetch('/api/youtube/scrape-channel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: channelInput.trim()
        }),
      });

      const scrapeResult = await scrapeResponse.json();
      console.log('Scrape result:', scrapeResult);

      if (!scrapeResponse.ok || !scrapeResult.channelId) {
        throw new Error(scrapeResult.error || 'Failed to extract channel information');
      }

      setImportProgress(30);

      // Check if channel is already imported (returned by scrape endpoint)
      if (scrapeResult.isAlreadyImported) {
        const sourceMessage = scrapeResult.importSource === 'competitor' 
          ? 'This channel is already imported as a competitor'
          : scrapeResult.importSource === 'discovery'
          ? 'This channel is already in your discovery system'
          : 'This channel is already in your system';
        
        toast({
          title: 'Channel Already Imported',
          description: sourceMessage,
          variant: 'destructive'
        });
        setIsImporting(false);
        setImportProgress(0);
        return;
      }

      setImportProgress(50);

      // Step 3: Import using the competitor import endpoint (supports all videos, not just 50)
      const importResponse = await fetch('/api/youtube/import-competitor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelId: scrapeResult.channelId,
          channelName: '', // Will be fetched by the endpoint
          timePeriod: 'all',
          maxVideos: 'all',
          excludeShorts: true,
          userId: '00000000-0000-0000-0000-000000000000'
        }),
      });

      setImportProgress(90);

      const importResult = await importResponse.json();

      if (!importResponse.ok) {
        throw new Error(importResult.error || 'Failed to import channel');
      }

      // Check if it's a queued job response
      if (importResult.jobId || importResult.status === 'queued') {
        toast({
          title: 'Import Started',
          description: `Processing channel in background. You can start another import!`,
        });
        setImportProgress(100);
        // Reset UI immediately so user can start another import
        setTimeout(() => {
          setChannelInput('');
          setImportProgress(0);
        }, 1000);
      } else {
        // Legacy sync response
        setImportProgress(100);
        toast({
          title: 'Success!',
          description: importResult.message || `Imported ${importResult.imported_videos || 0} videos from the channel`,
        });
      }

      // Reset form and reload channels
      setChannelInput('');
      await loadCompetitorChannels();

    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: 'Import Failed',
        description: (error as Error).message || 'Failed to import channel',
        variant: 'destructive'
      });
    } finally {
      // Only reset if not handled by async response
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const handleSearchChannels = async () => {
    if (!channelInput.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a search term or YouTube channel URL',
        variant: 'destructive'
      });
      return;
    }

    setIsSearching(true);
    setSearchResults([]);

    // Regular search
    await performChannelSearch(channelInput.trim());
  };

  const performChannelSearch = async (query: string) => {
    try {
      const response = await fetch('/api/youtube/search-channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to search channels');
      }

      // Sort results by subscriber count (highest first)
      const sortedChannels = (result.channels || []).sort((a, b) => {
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
          timePeriod: 'all',
          excludeShorts: true
        }),
      });

      const result = await response.json();
      if (response.ok) {
        console.log('Channel preview stats:', result);
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
          timePeriod: 'all',
          maxVideos: 'all',
          excludeShorts: true,
          userId: '00000000-0000-0000-0000-000000000000'
        }),
      });

      clearInterval(progressInterval);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to import channel');
      }

      // Check if it's a queued job response
      if (result.jobId || result.status === 'queued') {
        toast({
          title: 'Import Started',
          description: `Processing ${selectedChannel.title} in background. You can start another import!`,
        });
        setImportProgress(100);
        // Reset UI immediately so user can start another import
        setTimeout(() => {
          setSelectedChannel(null);
          setChannelInput('');
          setSearchResults([]);
          setShowSearchResults(false);
          setImportProgress(0);
          setIsImporting(false);
        }, 1000);
      } else {
        // Legacy sync response
        setImportProgress(100);
        toast({
          title: 'Success!',
          description: result.message || `Imported ${result.imported_videos} videos`,
        });
        // Reset form normally after sync import
        setChannelInput('');
        setSelectedChannel(null);
        setShowSearchResults(false);
        setSearchResults([]);
      }
      await loadCompetitorChannels();

    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: 'Import Failed',
        description: (error as Error).message || 'Failed to import competitor channel',
        variant: 'destructive'
      });
    } finally {
      // Only reset if not handled by async response
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const filteredChannels = competitorChannels.filter(channel => {
    if (!channelSearchTerm) return true;
    const searchLower = channelSearchTerm.toLowerCase();
    return (
      (channel.name && channel.name.toLowerCase().includes(searchLower)) ||
      (channel.handle && channel.handle.toLowerCase().includes(searchLower)) ||
      (channel.id && channel.id.toLowerCase().includes(searchLower))
    );
  });

  const handleChannelClick = (channelId: string) => {
    window.open(`/dashboard/youtube/channels/${channelId}`, '_blank');
  };

  // Removed handleRefreshChannel function as refresh buttons are no longer needed

  // Prevent hydration mismatch by waiting for client-side mount
  if (!isMounted) {
    return (
      <div className="container mx-auto max-w-7xl space-y-6 p-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Competitor Analysis</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      {/* Page Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Competitor Analysis</h1>
        <p className="text-muted-foreground">
          Import and analyze competitor channels to identify content opportunities and performance benchmarks
        </p>
      </div>

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
                      placeholder="Enter YouTube channel URL or search term..."
                      value={channelInput}
                      onChange={(e) => setChannelInput(e.target.value)}
                      disabled={isImporting || isSearching}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (channelInput.includes('youtube.com/')) {
                            handleDirectUrlImport();
                          } else {
                            handleSearchChannels();
                          }
                        }
                      }}
                      className="flex-1"
                    />
                    {channelInput.includes('youtube.com/') ? (
                      <Button 
                        onClick={handleDirectUrlImport}
                        disabled={!channelInput.trim() || isImporting}
                        className="min-w-[140px]"
                      >
                        {isImporting ? (
                          <>
                            <Download className="mr-2 h-4 w-4 animate-spin" />
                            Importing...
                          </>
                        ) : (
                          <>
                            <Download className="mr-2 h-4 w-4" />
                            Import URL
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button 
                        onClick={handleSearchChannels}
                        disabled={!channelInput.trim() || isSearching || isImporting}
                        variant="outline"
                        className="min-w-[140px]"
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
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Paste a YouTube channel URL for direct import, or search by keywords
                  </p>
                  {channelInput.includes('youtube.com/') && (
                    <Alert className="mt-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Direct URL import will use the unified import process to fetch all videos from this channel
                      </AlertDescription>
                    </Alert>
                  )}
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


              {/* Import Info */}
              {selectedChannel && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    Will import all videos (excluding Shorts) from <strong>{selectedChannel.title}</strong> using public YouTube data only.
                  </AlertDescription>
                </Alert>
              )}

              {/* Import Progress */}
              {isImporting && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {importProgress < 30 ? 'Extracting channel information...' :
                       importProgress < 50 ? 'Checking existing imports...' :
                       importProgress < 90 ? 'Importing videos with unified process...' :
                       'Finalizing import...'}
                    </span>
                    <span className="text-sm text-muted-foreground">{importProgress}%</span>
                  </div>
                  <Progress value={importProgress} className="w-full" />
                  <p className="text-sm text-muted-foreground">
                    {importProgress < 50 ? 'Extracting channel ID from URL without using API quota' :
                     'Using unified import to fetch videos, generate embeddings, and export data'}
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
          
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search channels by name, handle, or ID..."
              value={channelSearchTerm}
              onChange={(e) => setChannelSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="grid gap-4">
            {filteredChannels.map((channel) => (
              <Card 
                key={channel.id} 
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleChannelClick(channel.id)}
              >
                <CardContent className="p-6">
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
                    <div className="flex-1">
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
            
            {competitorChannels.length > 0 && filteredChannels.length === 0 && (
              <Card>
                <CardContent className="p-12 text-center">
                  <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-semibold mb-2">No channels found</h3>
                  <p className="text-muted-foreground">
                    No channels match your search term "{channelSearchTerm}"
                  </p>
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