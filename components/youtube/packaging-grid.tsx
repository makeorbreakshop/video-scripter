'use client';

import { PackagingCard } from './packaging-card';
import { usePackagingData } from '@/hooks/use-packaging-data';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function PackagingGrid() {
  const { data, loading, error, refetch } = usePackagingData();

  if (loading) {
    return (
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[...Array(12)].map((_, i) => (
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
          Showing {data.length} video{data.length !== 1 ? 's' : ''}
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
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {data.map((video) => (
          <PackagingCard key={video.id} video={video} />
        ))}
      </div>
    </div>
  );
}