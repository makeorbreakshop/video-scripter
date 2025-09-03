'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, X, Filter, ChevronDown, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { UnifiedVideoCard } from './unified-video-card';
import { useUnifiedSearch } from '@/hooks/use-unified-search';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import Image from 'next/image';

interface ChannelSuggestion {
  id: string;
  name: string;
  thumbnail: string | null;
  subscriberCount: number;
}

export function UnifiedSearch() {
  const router = useRouter();
  const [inputValue, setInputValue] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [suggestions, setSuggestions] = useState<ChannelSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const suggestionsTimeoutRef = useRef<NodeJS.Timeout>();
  
  const {
    query,
    setQuery,
    results,
    loading,
    loadingMore,
    error,
    queryTime,
    totalResults,
    hasMore,
    searchIntent,
    filters,
    setFilters,
    clearSearch,
    loadMoreResults,
    refetch,
  } = useUnifiedSearch({
    debounceMs: 300,
    limit: 20,
    type: 'all', // Always use 'all' search type
  });

  // Fetch autocomplete suggestions
  const fetchSuggestions = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setLoadingSuggestions(true);
    try {
      const response = await fetch(`/api/search/autocomplete?q=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();
      setSuggestions(data.suggestions || []);
      setShowSuggestions(data.suggestions && data.suggestions.length > 0);
    } catch (error) {
      console.error('Error fetching suggestions:', error);
      setSuggestions([]);
      setShowSuggestions(false);
    } finally {
      setLoadingSuggestions(false);
    }
  }, []);

  const handleSearch = (value: string) => {
    setInputValue(value);
    setQuery(value);
    setShowSuggestions(false);
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    setSelectedSuggestionIndex(-1);
    
    // Clear existing timeout
    if (suggestionsTimeoutRef.current) {
      clearTimeout(suggestionsTimeoutRef.current);
    }

    // Debounce autocomplete suggestions
    if (value.length >= 2) {
      suggestionsTimeoutRef.current = setTimeout(() => {
        fetchSuggestions(value);
      }, 200);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }

    // Still trigger main search with original debounce
    setQuery(value);
  };

  const handleSuggestionClick = (suggestion: ChannelSuggestion) => {
    const searchQuery = `channel: ${suggestion.name}`;
    setInputValue(searchQuery);
    setQuery(searchQuery);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => 
        prev < suggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
      e.preventDefault();
      handleSuggestionClick(suggestions[selectedSuggestionIndex]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    }
  };

  const handleClearSearch = () => {
    setInputValue('');
    clearSearch();
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
  };

  // Format subscriber count
  const formatSubscriberCount = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M subscribers`;
    } else if (count >= 1000) {
      return `${(count / 1000).toFixed(0)}K subscribers`;
    }
    return `${count} subscribers`;
  };

  // Intersection Observer for infinite scroll
  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasMore && !loadingMore && !loading) {
        loadMoreResults();
      }
    },
    [hasMore, loadingMore, loading, loadMoreResults]
  );

  useEffect(() => {
    const trigger = loadMoreTriggerRef.current;
    if (!trigger) return;

    const observer = new IntersectionObserver(handleIntersection, {
      threshold: 0.1,
      rootMargin: '100px',
    });

    observer.observe(trigger);

    return () => {
      observer.unobserve(trigger);
    };
  }, [handleIntersection]);

  // Group results by type
  const groupedResults = results.reduce((acc, result) => {
    if (!acc[result.type]) acc[result.type] = [];
    acc[result.type].push(result);
    return acc;
  }, {} as Record<string, typeof results>);

  const videoResults = groupedResults.video || [];
  const channelResults = groupedResults.channel || [];

  return (
    <div className="space-y-4">
      {/* Search Input */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder="Search videos, channels, or paste YouTube URL..."
                value={inputValue}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => inputValue.length >= 2 && suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                className="pl-10 pr-10"
                title="Try: @channelname, views:>10000, date:30d, channel:name"
              />
              {inputValue && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearSearch}
                  className="absolute right-1 top-1/2 transform -translate-y-1/2 h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
              
              {/* Autocomplete Dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute top-full mt-1 w-full bg-background border rounded-md shadow-lg z-50 overflow-hidden">
                  <div className="py-1">
                    {loadingSuggestions && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin inline mr-2" />
                        Loading suggestions...
                      </div>
                    )}
                    {suggestions.map((suggestion, index) => (
                      <button
                        key={suggestion.id}
                        className={`w-full px-3 py-2 flex items-center gap-3 hover:bg-accent transition-colors ${
                          index === selectedSuggestionIndex ? 'bg-accent' : ''
                        }`}
                        onMouseEnter={() => setSelectedSuggestionIndex(index)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSuggestionClick(suggestion);
                        }}
                      >
                        {suggestion.thumbnail ? (
                          <Image
                            src={suggestion.thumbnail}
                            alt={suggestion.name}
                            width={32}
                            height={32}
                            className="rounded-full flex-shrink-0"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                            <User className="h-4 w-4 text-white" />
                          </div>
                        )}
                        <div className="flex-1 text-left">
                          <div className="text-sm font-medium">{suggestion.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatSubscriberCount(suggestion.subscriberCount)}
                          </div>
                        </div>
                        <Search className="h-3 w-3 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowFilters(!showFilters)}
              className={showFilters ? 'bg-accent' : ''}
            >
              <Filter className="h-4 w-4" />
            </Button>
          </div>

          {/* Search Intent Badge */}
          {searchIntent && searchIntent.type !== 'keyword' && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Detected:</span>
              <Badge variant="secondary">
                {searchIntent.type === 'youtube_url' && 'YouTube URL'}
                {searchIntent.type === 'video_id' && 'Video ID'}
                {searchIntent.type === 'channel' && 'Channel Search'}
                {searchIntent.type === 'channel_prefix' && 'Channel Search'}
                {searchIntent.type === 'semantic' && 'Semantic Search'}
              </Badge>
            </div>
          )}

          {/* Filters */}
          <Collapsible open={showFilters} onOpenChange={setShowFilters}>
            <CollapsibleContent className="mt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* Performance Filter */}
                <Select
                  value={filters.performanceFilter || 'all'}
                  onValueChange={(value) => 
                    setFilters({ ...filters, performanceFilter: value === 'all' ? undefined : value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Performance" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Performance</SelectItem>
                    <SelectItem value="excellent">Excellent (2x+)</SelectItem>
                    <SelectItem value="good">Good (1.5-2x)</SelectItem>
                    <SelectItem value="average">Average (0.8-1.5x)</SelectItem>
                    <SelectItem value="poor">Poor (&lt;0.8x)</SelectItem>
                  </SelectContent>
                </Select>

                {/* Date Filter */}
                <Select
                  value={filters.dateFilter || 'all'}
                  onValueChange={(value) => 
                    setFilters({ ...filters, dateFilter: value === 'all' ? undefined : value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Date Range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Time</SelectItem>
                    <SelectItem value="30days">Last 30 Days</SelectItem>
                    <SelectItem value="3months">Last 3 Months</SelectItem>
                    <SelectItem value="6months">Last 6 Months</SelectItem>
                    <SelectItem value="1year">Last Year</SelectItem>
                  </SelectContent>
                </Select>

                {/* Competitor Filter */}
                <Select
                  value={filters.competitorFilter || 'all'}
                  onValueChange={(value) => 
                    setFilters({ ...filters, competitorFilter: value === 'all' ? undefined : value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Video Source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Videos</SelectItem>
                    <SelectItem value="mine">My Videos</SelectItem>
                    <SelectItem value="competitors">Competitors</SelectItem>
                  </SelectContent>
                </Select>

                {/* View Count Range */}
                <div className="flex gap-2">
                  <Input
                    type="number"
                    placeholder="Min views"
                    value={filters.minViews || ''}
                    onChange={(e) => 
                      setFilters({ ...filters, minViews: e.target.value ? parseInt(e.target.value) : undefined })
                    }
                    className="w-full"
                  />
                  <Input
                    type="number"
                    placeholder="Max views"
                    value={filters.maxViews || ''}
                    onChange={(e) => 
                      setFilters({ ...filters, maxViews: e.target.value ? parseInt(e.target.value) : undefined })
                    }
                    className="w-full"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* Search Stats */}
      {query && !loading && results.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div>
            Found {totalResults} results
            {queryTime && ` in ${queryTime}ms`}
          </div>
          {hasMore && (
            <div>
              Showing {results.length} of {totalResults}
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <Card>
          <CardContent className="py-12">
            <div className="flex items-center justify-center">
              <div className="text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
                <p className="text-lg font-medium">Searching...</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {query && `Searching for "${query}"`}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {error && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={refetch}
              className="ml-4"
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Results */}
      {!loading && !loadingMore && query && results.length === 0 && queryTime !== null && (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-lg font-semibold mb-2">No results found</h3>
            <p className="text-muted-foreground mb-4">
              Try different keywords or adjust your filters
            </p>
            {searchIntent?.type === 'semantic' && (
              <p className="text-sm text-muted-foreground">
                Semantic search works best with descriptive phrases like "how to save money" or "productivity tips"
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Channel Results Section */}
      {channelResults.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            Channels
            <Badge variant="secondary">{channelResults.length}</Badge>
          </h3>
          <div className="grid gap-3">
            {channelResults.map((channel) => (
              <Card key={channel.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Channel Avatar */}
                    <div className="relative flex-shrink-0">
                      <div className="w-16 h-16 rounded-full overflow-hidden bg-muted">
                        <img
                          src={channel.channel_thumbnail || `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.title)}&background=random&size=128`}
                          alt={channel.title}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            // Fallback to a placeholder if channel image fails
                            e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(channel.title)}&background=random&size=128`;
                          }}
                        />
                      </div>
                    </div>
                    
                    {/* Channel Info */}
                    <div className="flex-1">
                      <h4 className="font-medium text-base">{channel.title}</h4>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                        {channel.video_count && (
                          <span>{channel.video_count} videos</span>
                        )}
                        {channel.view_count && (
                          <span>{(channel.view_count / 1000000).toFixed(1)}M total views</span>
                        )}
                      </div>
                    </div>
                    
                    {/* Action Button */}
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => router.push(`/dashboard/youtube/channels/${channel.channel_id}`)}
                    >
                      View Channel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Video Results Grid */}
      {videoResults.length > 0 && (
        <div className="space-y-3">
          {channelResults.length > 0 && (
            <h3 className="text-lg font-semibold flex items-center gap-2">
              Videos
              <Badge variant="secondary">{videoResults.length}</Badge>
            </h3>
          )}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {videoResults.map((video, index) => (
              <UnifiedVideoCard
                key={`${video.id}-${video.match_type}-${index}`}
                video={{
                  id: video.id,
                  title: video.title,
                  channel_id: video.channel_id || '',
                  channel_name: video.channel_name || '',
                  view_count: video.view_count || 0,
                  published_at: video.published_at || '',
                  thumbnail_url: video.thumbnail_url || '',
                  baseline_cpm_prediction_ratio: video.performance_ratio,
                }}
                context={{
                  type: 'search',
                  similarity_score: video.score || 0,
                  search_query: query,
                  performance_ratio: video.performance_ratio
                }}
                showPerformance={true}
                additionalInfo={
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="text-xs">
                      {video.match_type}
                    </Badge>
                    {video.score > 0.8 && (
                      <Badge variant="secondary" className="text-xs">
                        High relevance
                      </Badge>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Load More Trigger */}
      {hasMore && !loading && (
        <div ref={loadMoreTriggerRef} className="h-20 flex items-center justify-center">
          {loadingMore && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading more...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}