'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Loader2, Target, Clock, AlertCircle, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useSemanticSearch } from '@/hooks/use-semantic-search';
import { UnifiedVideoCard } from './unified-video-card';

export function SemanticSearch() {
  const [inputValue, setInputValue] = useState('');
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  
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
    totalAvailable,
    clearSearch,
    loadMoreResults,
  } = useSemanticSearch({
    debounceMs: 500,
    minScore: 0.1,
    limit: 20,
  });

  const handleSearch = (value: string) => {
    setInputValue(value);
    setQuery(value);
  };

  const handleClearSearch = () => {
    setInputValue('');
    clearSearch();
  };

  // Intersection Observer for infinite scroll
  const handleIntersection = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasMore && !loadingMore && !loading) {
        console.log('🔄 Loading more results...');
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

  return (
    <div className="space-y-6">
      {/* Search Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Semantic Search</h1>
          <p className="text-muted-foreground">Find videos with similar content using AI-powered search</p>
        </div>
      </div>

      {/* Search Input */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search for videos with similar content (e.g., 'how to save money', 'productivity tips')..."
                value={inputValue}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-10 pr-10"
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
            </div>
            {loading && (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Search Stats */}
          {(query || results.length > 0) && (
            <div className="flex items-center gap-4 mt-4 pt-4 border-t">
              {results.length > 0 && (
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  {results.length}{totalAvailable > results.length && ` of ${totalAvailable}`} results
                </Badge>
              )}
              {queryTime && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {queryTime}ms
                </Badge>
              )}
              {hasMore && (
                <Badge variant="outline" className="text-muted-foreground">
                  Scroll for more
                </Badge>
              )}
              {query && (
                <span className="text-sm text-muted-foreground">
                  Searching for: "<span className="font-medium">{query}</span>"
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">Search failed</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Results */}
      {!loading && !error && query && results.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center">
            <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No similar videos found</h3>
            <p className="text-muted-foreground">
              Try adjusting your search terms or using different keywords
            </p>
          </CardContent>
        </Card>
      )}

      {/* Results Grid */}
      {results.length > 0 && (
        <div>
          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {results.map((result) => (
              <UnifiedVideoCard 
                key={result.video_id}
                video={{
                  id: result.video_id,
                  title: result.title,
                  view_count: result.view_count,
                  published_at: result.published_at,
                  thumbnail_url: result.thumbnail_url,
                  channel_id: result.channel_id,
                  channel_name: result.channel_name,
                  is_competitor: true // Search results are typically from competitor videos
                }}
                context={{
                  type: 'search',
                  similarity_score: result.similarity_score,
                  search_query: query,
                  performance_ratio: result.performance_ratio
                }}
              />
            ))}
          </div>
          
          {/* Infinite Scroll Trigger */}
          {hasMore && (
            <div ref={loadMoreTriggerRef} className="flex justify-center py-8">
              {loadingMore ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Loading more results...</span>
                </div>
              ) : (
                <div className="text-center text-muted-foreground">
                  <div className="text-sm">Scroll down to load more results</div>
                </div>
              )}
            </div>
          )}
          
          {/* No More Results Indicator */}
          {!hasMore && results.length > 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <div className="text-sm">
                Showing all {totalAvailable} results
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!query && !loading && (
        <Card>
          <CardContent className="p-12 text-center">
            <Search className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-xl font-medium mb-2">Semantic Video Search</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Enter a search query to find videos with similar content using AI-powered semantic matching. 
              Search by topic, theme, or concept rather than exact keywords.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Badge variant="outline" className="cursor-pointer" onClick={() => handleSearch('how to save money')}>
                how to save money
              </Badge>
              <Badge variant="outline" className="cursor-pointer" onClick={() => handleSearch('productivity tips')}>
                productivity tips
              </Badge>
              <Badge variant="outline" className="cursor-pointer" onClick={() => handleSearch('business advice')}>
                business advice
              </Badge>
              <Badge variant="outline" className="cursor-pointer" onClick={() => handleSearch('morning routine')}>
                morning routine
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}