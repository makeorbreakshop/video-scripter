/**
 * YouTube Packaging Page
 * Analyze title and thumbnail performance for content optimization
 */

import { Suspense } from 'react';
import { Metadata } from 'next';
import { PackagingGrid } from '@/components/youtube/packaging-grid';
import { PackagingFilters } from '@/components/youtube/packaging-filters';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Packaging Analysis | YouTube Dashboard',
  description: 'Analyze title and thumbnail performance for content optimization',
};

export default function PackagingPage() {
  return (
    <div className="flex-1 flex flex-col bg-background min-h-screen">

      {/* Sticky Filters - Improved positioning and margins */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80 border-b border-border">
        <div className="px-4 sm:px-6 py-3">
          <div className="bg-card rounded-lg border border-border p-3 sm:p-4 shadow-md">
            <Suspense fallback={<FiltersSkeleton />}>
              <PackagingFilters />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Content Grid - Optimized spacing */}
      <div className="flex-1 px-4 sm:px-6 py-4">
        <div className="bg-card rounded-lg border border-border p-3 sm:p-4 shadow-sm min-h-[60vh]">
          <Suspense fallback={<GridSkeleton />}>
            <PackagingGrid />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

function FiltersSkeleton() {
  return (
    <div className="space-y-3">
      {/* Main filter row skeleton */}
      <div className="flex flex-col lg:flex-row gap-3">
        <Skeleton className="h-10 flex-1" />
        <div className="flex gap-2 shrink-0">
          <Skeleton className="h-10 w-40 sm:w-48" />
          <Skeleton className="h-10 w-10" />
        </div>
      </div>
      
      {/* Secondary filter row skeleton */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Skeleton className="h-10 w-full sm:w-40" />
        <Skeleton className="h-10 w-full sm:w-44" />
        <Skeleton className="h-10 w-full sm:w-40" />
        <Skeleton className="h-8 w-20 shrink-0" />
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="space-y-6">
      {/* Results count skeleton */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-20" />
      </div>

      {/* Video grid skeleton */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-lg overflow-hidden animate-pulse">
            <div className="aspect-video bg-muted relative">
              {/* Thumbnail skeleton with shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
              {/* Performance badge skeleton */}
              <div className="absolute top-3 right-3">
                <Skeleton className="h-6 w-12 rounded-full" />
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-6 w-full rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}