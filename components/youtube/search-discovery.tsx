'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Search, 
  Users, 
  PlayCircle, 
  ExternalLink,
  Plus,
  Filter,
  Star,
  Lightbulb,
  Zap,
  TrendingUp
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface SearchFilters {
  minSubscribers?: number;
  maxSubscribers?: number;
  minVideos?: number;
  maxVideos?: number;
}

interface ChannelResult {
  channelId: string;
  title: string;
  description: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  publishedAt: string;
  thumbnailUrl: string;
  customUrl?: string;
  relevanceScore: number;
  status: string;
}

interface VideoResult {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
  channelData?: {
    subscriberCount: number;
    videoCount: number;
    rssBaseline: number | null;
  } | null;
}

interface SearchResults {
  success: boolean;
  searchTerm: string;
  searchType?: 'channel' | 'video';
  stats?: {
    rawFromYoutube?: number;
    videosFound?: number;
    uniqueChannels?: number;
    channelsAfterFilters?: number;
    channelsAlreadyExists?: number;
    afterFilters: number;
    alreadyExists: number;
    newChannelsAdded: number;
    filterBreakdown: {
      bySubscribers: number;
      byVideoCount: number;
      byAge: number;
      totalFiltered: number;
    };
  };
  videos?: VideoResult[];
  // Legacy fields for backward compatibility
  channelsDiscovered: number;
  channelsAdded: number;
  channelsFiltered: number;
  channelsExisting: number;
  channels: ChannelResult[];
}

interface SmartSuggestion {
  term: string;
  source: string;
  confidence: number;
  reasoning: string;
}

interface SmartSuggestionsResponse {
  success: boolean;
  suggestions: SmartSuggestion[];
  analyzedVideos: number;
  message: string;
}

export function SearchDiscovery() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [filters, setFilters] = useState<SearchFilters>({
    minSubscribers: 100,
    maxSubscribers: 10000000,
    minVideos: 5
  });
  const [showFilters, setShowFilters] = useState(false);
  const [smartSuggestions, setSmartSuggestions] = useState<SmartSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchType, setSearchType] = useState<'channel' | 'video'>('channel');

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;

    setIsSearching(true);
    try {
      const response = await fetch('/api/youtube/discovery/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          searchTerm: searchTerm.trim(),
          filters,
          maxResults: 50,
          searchType
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setSearchResults(data);
      } else {
        let error;
        try {
          error = await response.json();
        } catch (parseError) {
          error = { message: `HTTP ${response.status}: ${response.statusText}` };
        }
        console.error('Search failed:', error);
      }
    } catch (error) {
      console.error('Error performing search:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const loadSmartSuggestions = async () => {
    setIsLoadingSuggestions(true);
    try {
      const response = await fetch('/api/youtube/discovery/smart-suggestions');
      
      if (response.ok) {
        const data = await response.json();
        setSmartSuggestions(data.suggestions || []);
        setShowSuggestions(true);
      } else {
        const error = await response.json();
        console.error('Failed to load suggestions:', error);
      }
    } catch (error) {
      console.error('Error loading smart suggestions:', error);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const searchFromSuggestion = (suggestion: SmartSuggestion) => {
    setSearchTerm(suggestion.term);
    setShowSuggestions(false);
    // Auto-execute search
    setTimeout(() => {
      const searchButton = document.querySelector('[data-search-button]') as HTMLButtonElement;
      searchButton?.click();
    }, 100);
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getRelevanceColor = (score: number): string => {
    if (score >= 7) return 'bg-green-100 text-green-800';
    if (score >= 5) return 'bg-yellow-100 text-yellow-800';
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="space-y-6">
      {/* Search Interface */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            YouTube {searchType === 'channel' ? 'Channel' : 'Video'} Search Discovery
          </CardTitle>
          <CardDescription>
            Search for {searchType === 'channel' ? 'channels' : 'videos'} using keywords and {searchType === 'video' ? 'discover channels to' : ''} add them to the review queue
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Smart Suggestions Button */}
          <div className="flex justify-between items-center">
            <div className="flex gap-2">
              <Button 
                onClick={loadSmartSuggestions}
                disabled={isLoadingSuggestions}
                variant="outline"
                className="text-sm"
              >
                <Lightbulb className="h-4 w-4 mr-2" />
                {isLoadingSuggestions ? 'Analyzing...' : 'Smart Suggestions'}
              </Button>
              {smartSuggestions.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {smartSuggestions.length} suggestions ready
                </Badge>
              )}
            </div>
          </div>

          {/* Search Type Toggle */}
          <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg">
            <Label className="text-sm font-medium">Search by:</Label>
            <div className="flex gap-2">
              <Button
                variant={searchType === 'channel' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSearchType('channel')}
                className="text-xs"
              >
                <Users className="h-3 w-3 mr-1" />
                Channels
              </Button>
              <Button
                variant={searchType === 'video' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSearchType('video')}
                className="text-xs"
              >
                <PlayCircle className="h-3 w-3 mr-1" />
                Videos
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              {searchType === 'channel' ? 'Direct channel search (current method)' : 'Video search → channel discovery (new efficient method)'}
            </div>
          </div>

          {/* Search Input */}
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder={searchType === 'channel' 
                  ? "Enter search keywords (e.g. 'woodworking workshop', 'DIY build')"
                  : "Enter video keywords (e.g. 'shop organization', 'garage storage')"
                }
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <Button 
              onClick={() => setShowFilters(!showFilters)}
              variant="outline"
              size="icon"
            >
              <Filter className="h-4 w-4" />
            </Button>
            <Button 
              onClick={handleSearch}
              disabled={isSearching || !searchTerm.trim()}
              data-search-button
            >
              <Search className="h-4 w-4 mr-2" />
              {isSearching ? 'Searching...' : 'Search'}
            </Button>
          </div>

          {/* Filters */}
          {showFilters && (
            <Card className="p-4 bg-gray-50">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label htmlFor="minSubscribers">Min Subscribers</Label>
                  <Select 
                    value={filters.minSubscribers?.toString() || ''}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, minSubscribers: parseInt(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Min subscribers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Any</SelectItem>
                      <SelectItem value="1000">1K+</SelectItem>
                      <SelectItem value="5000">5K+</SelectItem>
                      <SelectItem value="10000">10K+</SelectItem>
                      <SelectItem value="50000">50K+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="maxSubscribers">Max Subscribers</Label>
                  <Select 
                    value={filters.maxSubscribers?.toString() || ''}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, maxSubscribers: parseInt(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Max subscribers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="100000">100K</SelectItem>
                      <SelectItem value="500000">500K</SelectItem>
                      <SelectItem value="1000000">1M</SelectItem>
                      <SelectItem value="5000000">5M</SelectItem>
                      <SelectItem value="10000000">10M</SelectItem>
                      <SelectItem value="999999999">Any</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="minVideos">Min Videos</Label>
                  <Select 
                    value={filters.minVideos?.toString() || ''}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, minVideos: parseInt(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Min videos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Any</SelectItem>
                      <SelectItem value="10">10+</SelectItem>
                      <SelectItem value="50">50+</SelectItem>
                      <SelectItem value="100">100+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="maxVideos">Max Videos</Label>
                  <Select 
                    value={filters.maxVideos?.toString() || ''}
                    onValueChange={(value) => setFilters(prev => ({ ...prev, maxVideos: parseInt(value) }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Max videos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1000">1K</SelectItem>
                      <SelectItem value="5000">5K</SelectItem>
                      <SelectItem value="999999999">Any</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* Smart Suggestions */}
      {showSuggestions && smartSuggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Smart Search Suggestions
            </CardTitle>
            <CardDescription>
              Based on your top performing videos, try these search terms to find similar successful channels
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {smartSuggestions.map((suggestion, index) => (
                <Card 
                  key={index} 
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => searchFromSuggestion(suggestion)}
                >
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      {/* Search Term */}
                      <div className="flex items-center justify-between">
                        <h4 className="font-medium text-sm truncate">
                          "{suggestion.term}"
                        </h4>
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${
                            suggestion.confidence >= 8 ? 'bg-green-50 text-green-700' :
                            suggestion.confidence >= 6 ? 'bg-yellow-50 text-yellow-700' :
                            'bg-gray-50 text-gray-700'
                          }`}
                        >
                          {suggestion.confidence.toFixed(1)}/10
                        </Badge>
                      </div>

                      {/* Source Badge */}
                      <div className="flex items-center gap-2">
                        {suggestion.source === 'high_performance' && (
                          <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700">
                            <TrendingUp className="h-3 w-3 mr-1" />
                            Top Performer
                          </Badge>
                        )}
                        {suggestion.source === 'semantic_variation' && (
                          <Badge variant="secondary" className="text-xs bg-purple-50 text-purple-700">
                            <Zap className="h-3 w-3 mr-1" />
                            Variation
                          </Badge>
                        )}
                        {suggestion.source === 'niche_expansion' && (
                          <Badge variant="secondary" className="text-xs bg-orange-50 text-orange-700">
                            <Search className="h-3 w-3 mr-1" />
                            Expansion
                          </Badge>
                        )}
                      </div>

                      {/* Reasoning */}
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {suggestion.reasoning}
                      </p>

                      {/* Search Button */}
                      <Button 
                        size="sm" 
                        className="w-full text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          searchFromSuggestion(suggestion);
                        }}
                      >
                        <Search className="h-3 w-3 mr-1" />
                        Search This
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            
            {/* Actions */}
            <div className="flex justify-between items-center mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Click any suggestion to search for similar channels
              </p>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowSuggestions(false)}
              >
                Hide Suggestions
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search Results */}
      {searchResults && (
        <Card>
          <CardHeader>
            <CardTitle>Search Results: "{searchResults.searchTerm}"</CardTitle>
            <CardDescription>
              {searchResults.searchType === 'video' ? (
                searchResults.stats ? (
                  `Found ${searchResults.stats.videosFound} videos from ${searchResults.stats.uniqueChannels} unique channels, ${searchResults.stats.newChannelsAdded} new channels added to review queue`
                ) : (
                  `Found ${searchResults.videos?.length || 0} videos, ${searchResults.channelsAdded} new channels added to review queue`
                )
              ) : (
                searchResults.stats ? (
                  `Found ${searchResults.stats.rawFromYoutube} channels from YouTube, ${searchResults.stats.newChannelsAdded} new channels added to review queue`
                ) : (
                  // Fallback to legacy format
                  <>
                    Found {searchResults.channelsDiscovered} channels, 
                    added {searchResults.channelsAdded} new to review queue
                    {searchResults.channelsExisting > 0 && `, ${searchResults.channelsExisting} already discovered`}
                    {searchResults.channelsFiltered > 0 && `, ${searchResults.channelsFiltered} filtered out`}
                  </>
                )
              )}
            </CardDescription>
            {searchResults.stats && (
              <div className="space-y-2 mt-2">
                <div className="flex flex-wrap gap-4 text-sm">
                  {searchResults.searchType === 'video' ? (
                    <>
                      <Badge variant="outline" className="text-blue-700">
                        Videos found: {searchResults.stats.videosFound}
                      </Badge>
                      <Badge variant="outline" className="text-cyan-700">
                        Unique channels: {searchResults.stats.uniqueChannels}
                      </Badge>
                      <Badge variant="outline" className="text-green-700">
                        After filters: {searchResults.stats.channelsAfterFilters}
                      </Badge>
                      <Badge variant="outline" className="text-orange-700">
                        Already exists: {searchResults.stats.channelsAlreadyExists}
                      </Badge>
                      <Badge variant="outline" className="text-purple-700">
                        New added: {searchResults.stats.newChannelsAdded}
                      </Badge>
                    </>
                  ) : (
                    <>
                      <Badge variant="outline" className="text-blue-700">
                        YouTube returned: {searchResults.stats.rawFromYoutube}
                      </Badge>
                      <Badge variant="outline" className="text-green-700">
                        After filters: {searchResults.stats.afterFilters}
                      </Badge>
                      <Badge variant="outline" className="text-orange-700">
                        Already exists: {searchResults.stats.alreadyExists}
                      </Badge>
                      <Badge variant="outline" className="text-purple-700">
                        New added: {searchResults.stats.newChannelsAdded}
                      </Badge>
                    </>
                  )}
                </div>
                {searchResults.stats.filterBreakdown.totalFiltered > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Filtered out: {searchResults.stats.filterBreakdown.totalFiltered} total
                    {searchResults.stats.filterBreakdown.bySubscribers > 0 && ` (${searchResults.stats.filterBreakdown.bySubscribers} by subscribers)`}
                    {searchResults.stats.filterBreakdown.byVideoCount > 0 && ` (${searchResults.stats.filterBreakdown.byVideoCount} by video count)`}
                    {searchResults.stats.filterBreakdown.byAge > 0 && ` (${searchResults.stats.filterBreakdown.byAge} by age)`}
                  </div>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {/* Video Results */}
            {searchResults.searchType === 'video' && searchResults.videos ? (
              searchResults.videos.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No videos found matching your criteria
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {searchResults.videos.map((video) => (
                    <Card key={video.videoId} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="space-y-3">
                          {/* Video Thumbnail */}
                          <div className="relative">
                            <img
                              src={video.thumbnailUrl}
                              alt={video.title}
                              className="w-full h-24 object-cover rounded"
                            />
                            <div className="absolute bottom-1 right-1 bg-black bg-opacity-75 text-white px-1 py-0.5 rounded text-xs">
                              <PlayCircle className="h-3 w-3" />
                            </div>
                          </div>
                          
                          {/* Video Info */}
                          <div>
                            <h3 className="font-semibold text-sm line-clamp-2 mb-1" title={video.title}>
                              {video.title}
                            </h3>
                            
                            {/* Channel Info */}
                            <div className="text-xs text-muted-foreground mb-2">
                              <span className="font-medium">{video.channelTitle}</span>
                              {video.channelData && (
                                <div className="flex items-center gap-3 mt-1">
                                  <div className="flex items-center gap-1">
                                    <Users className="h-3 w-3" />
                                    {formatNumber(video.channelData.subscriberCount)}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <PlayCircle className="h-3 w-3" />
                                    {formatNumber(video.channelData.videoCount)}
                                  </div>
                                  {video.channelData.rssBaseline && (
                                    <div className="flex items-center gap-1">
                                      <TrendingUp className="h-3 w-3" />
                                      {formatNumber(video.channelData.rssBaseline)} avg
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Published Date */}
                            <div className="text-xs text-muted-foreground mb-2">
                              {new Date(video.publishedAt).toLocaleDateString()}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs flex-1"
                                onClick={() => window.open(`https://youtube.com/watch?v=${video.videoId}`, '_blank')}
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                Watch
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs flex-1"
                                onClick={() => window.open(`https://youtube.com/channel/${video.channelId}`, '_blank')}
                              >
                                <Users className="h-3 w-3 mr-1" />
                                Channel
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Description Preview */}
                        {video.description && (
                          <div className="mt-3 pt-3 border-t">
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {video.description}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )
            ) : (
              /* Channel Results */
              searchResults.channels.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No new channels found matching your criteria
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {searchResults.channels.map((channel) => (
                    <Card key={channel.channelId} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          {/* Channel Avatar */}
                          <img
                            src={channel.thumbnailUrl}
                            alt={channel.title}
                            className="w-12 h-12 rounded-full object-cover"
                          />
                          
                          {/* Channel Info */}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-sm truncate" title={channel.title}>
                              {channel.title}
                            </h3>
                            
                            {/* Stats */}
                            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                              <div className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {formatNumber(channel.subscriberCount)}
                              </div>
                              <div className="flex items-center gap-1">
                                <PlayCircle className="h-3 w-3" />
                                {formatNumber(channel.videoCount)}
                              </div>
                            </div>

                            {/* Relevance Score */}
                            <div className="mt-2">
                              <Badge 
                                variant="secondary" 
                                className={`text-xs ${getRelevanceColor(channel.relevanceScore)}`}
                              >
                                <Star className="h-3 w-3 mr-1" />
                                {channel.relevanceScore.toFixed(1)}/10
                              </Badge>
                            </div>

                            {/* Status */}
                            <div className="mt-2">
                              <Badge variant="outline" className="text-xs">
                                {channel.status === 'pending' ? 'Added to Review Queue' : channel.status}
                              </Badge>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 mt-3">
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs"
                                onClick={() => window.open(`https://youtube.com/channel/${channel.channelId}`, '_blank')}
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                View
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Description Preview */}
                        {channel.description && (
                          <div className="mt-3 pt-3 border-t">
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {channel.description}
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}