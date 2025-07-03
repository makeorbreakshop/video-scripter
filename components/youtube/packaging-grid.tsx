'use client';

import { useEffect, useRef, useCallback } from 'react';
import { PackagingCard } from './packaging-card';
import { usePackagingData } from '@/hooks/use-packaging-data';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function PackagingGrid() {
  const { data, loading, error, refetch, pagination, loadMore, loadingMore } = usePackagingData();
  const observerRef = useRef<IntersectionObserver>();
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Intersection Observer for infinite scroll
  const lastElementRef = useCallback((node: HTMLDivElement | null) => {
    if (loading || loadingMore) return;
    if (observerRef.current) observerRef.current.disconnect();
    
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && pagination?.hasMore) {
        loadMore();
      }
    }, {
      threshold: 0.1,
      rootMargin: '100px' // Load more when element is 100px away from viewport
    });
    
    if (node) observerRef.current.observe(node);
  }, [loading, loadingMore, pagination?.hasMore, loadMore]);

  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(9)].map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="aspect-video bg-muted animate-pulse" />
            <div className="p-4 space-y-3">
              <div className="space-y-2">
                <div className="h-4 bg-muted rounded animate-pulse" />
                <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
              </div>
              <div className="flex items-center justify-between">
                <div className="h-4 w-16 bg-muted rounded animate-pulse" />
                <div className="h-4 w-20 bg-muted rounded animate-pulse" />
              </div>
              <div className="h-6 bg-muted/50 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert className="max-w-2xl mx-auto">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>{error}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={refetch}
            className="ml-4"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">📺</div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No videos found</h3>
        <p className="text-gray-600 mb-4">
          Try adjusting your filters or search terms to find videos.
        </p>
        <Button variant="outline" onClick={refetch}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh Data
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Results count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {data.length} of {pagination?.totalCount || data.length} video{(pagination?.totalCount || data.length) !== 1 ? 's' : ''}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={refetch}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Video grid */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((video, index) => {
          // Apply intersection observer to last few items for infinite scroll
          const isLastItem = index === data.length - 1;
          const isNearEnd = index >= data.length - 4; // Apply to last 4 items for better UX
          
          return (
            <div
              key={video.id}
              ref={isLastItem ? lastElementRef : undefined}
              className={isNearEnd ? 'scroll-trigger' : undefined}
            >
              <PackagingCard video={video} />
            </div>
          );
        })}
      </div>

      {/* Load more indicator */}
      {loadingMore && (
        <div className="flex justify-center items-center py-8">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading more videos...</span>
          </div>
        </div>
      )}

      {/* Manual load more button (fallback) */}
      {pagination?.hasMore && !loadingMore && data.length > 0 && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            onClick={loadMore}
            className="w-full max-w-xs"
          >
            Load More Videos
          </Button>
        </div>
      )}

      {/* End of results indicator */}
      {pagination && !pagination.hasMore && data.length > 0 && (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground">
            You've reached the end of the results
          </p>
        </div>
      )}
    </div>
  );
}