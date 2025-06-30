'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
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
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function CompetitorsPage() {
  const [channelInput, setChannelInput] = useState('');
  const [timePeriod, setTimePeriod] = useState('90');
  const [maxVideos, setMaxVideos] = useState('50');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [competitorChannels, setCompetitorChannels] = useState<CompetitorChannel[]>([]);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<SearchResult | null>(null);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const { toast } = useToast();

  // Get current user
  useEffect(() => {
    const getUser = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      console.log('Auth check - user:', user);
      console.log('Auth check - error:', error);
      setCurrentUser(user);
    };
    getUser();
  }, []);

  // Load competitor channels
  useEffect(() => {
    loadCompetitorChannels();
  }, [currentUser]);

  // Also load when component mounts
  useEffect(() => {
    loadCompetitorChannels();
  }, []);

  const loadCompetitorChannels = async () => {
    try {
      const { data: videos, error } = await supabase
        .from('videos')
        .select(`
          channel_id,
          imported_by,
          import_date,
          metadata
        `)
        .eq('is_competitor', true)
        .eq('imported_by', currentUser?.id || '00000000-0000-0000-0000-000000000000');

      if (error) throw error;

      // Group by channel and get latest info
      const channelMap = new Map();
      videos?.forEach(video => {
        const channelId = video.channel_id;
        if (!channelMap.has(channelId) || new Date(video.import_date) > new Date(channelMap.get(channelId).import_date)) {
          channelMap.set(channelId, video);
        }
      });

      // Get video counts per channel
      const channelIds = Array.from(channelMap.keys());
      const channelCounts = await Promise.all(
        channelIds.map(async (channelId) => {
          const { count } = await supabase
            .from('videos')
            .select('*', { count: 'exact', head: true })
            .eq('channel_id', channelId)
            .eq('is_competitor', true);
          return { channelId, count: count || 0 };
        })
      );

      const channels: CompetitorChannel[] = Array.from(channelMap.values()).map(video => {
        const countData = channelCounts.find(c => c.channelId === video.channel_id);
        const channelStats = video.metadata?.channel_stats || {};
        
        return {
          id: video.metadata?.youtube_channel_id || video.channel_id,
          name: video.channel_id, // channel_id stores the channel name
          handle: `@${video.channel_id.replace(/\s+/g, '').toLowerCase()}`,
          subscriberCount: channelStats.subscriber_count || 0,
          videoCount: countData?.count || 0,
          lastImport: formatTimeAgo(video.import_date),
          status: 'active' as const,
          thumbnailUrl: channelStats.channel_thumbnail
        };
      });

      setCompetitorChannels(channels);
    } catch (error) {
      console.error('Error loading competitor channels:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      console.error('Current user:', currentUser);
      toast({
        title: 'Error',
        description: 'Failed to load competitor channels',
        variant: 'destructive'
      });
    }
  };

  const formatTimeAgo = (dateString: string) => {
    // Use a more stable date formatting to avoid hydration mismatch
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
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

      setSearchResults(result.channels || []);
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
        description: error.message || 'Failed to search for channels',
        variant: 'destructive'
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectChannel = (channel: SearchResult) => {
    setSelectedChannel(channel);
    setShowSearchResults(false);
    toast({
      title: 'Channel Selected',
      description: `Selected: ${channel.title}`,
      variant: 'default'
    });
  };

  const handleImportChannel = async () => {
    console.log('handleImportChannel called');
    console.log('selectedChannel:', selectedChannel);
    console.log('currentUser:', currentUser);
    
    if (!selectedChannel) {
      toast({
        title: 'Error',
        description: 'Please search for and select a channel first',
        variant: 'destructive'
      });
      return;
    }
    
    if (!currentUser) {
      console.log('No current user - using temporary bypass');
      toast({
        title: 'Warning',
        description: 'Testing mode - user authentication bypass',
        variant: 'default'
      });
    }
    
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
          userId: currentUser?.id || '00000000-0000-0000-0000-000000000000'
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
        description: error.message || 'Failed to import competitor channel',
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Competitor Analysis</h1>
        <p className="text-muted-foreground">
          Import and analyze competitor channels to identify content opportunities and trends
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
                      placeholder="Search by channel name, @handle, or keyword..."
                      value={channelInput}
                      onChange={(e) => setChannelInput(e.target.value)}
                      disabled={isImporting || isSearching}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearchChannels()}
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
                          className="p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
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
                              <h5 className="font-medium truncate">{channel.title}</h5>
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

              {/* Import Settings */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="time-period">Time Period</Label>
                  <Select value={timePeriod} onValueChange={setTimePeriod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">Last 30 days</SelectItem>
                      <SelectItem value="90">Last 90 days</SelectItem>
                      <SelectItem value="180">Last 6 months</SelectItem>
                      <SelectItem value="365">Last year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="max-videos">Max Videos</Label>
                  <Select value={maxVideos} onValueChange={setMaxVideos}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25 videos</SelectItem>
                      <SelectItem value="50">50 videos</SelectItem>
                      <SelectItem value="100">100 videos</SelectItem>
                      <SelectItem value="200">200 videos</SelectItem>
                    </SelectContent>
                  </Select>
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
                            Imported: {channel.lastImport}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Refresh
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