/**
 * YouTube Packaging Page
 * Analyze title and thumbnail performance for content optimization
 */

import { Suspense } from 'react';
import { Metadata } from 'next';
import { PackagingGrid } from '@/components/youtube/packaging-grid';
import { PackagingFilters } from '@/components/youtube/packaging-filters';
import { ExportButton } from '@/components/youtube/export-button';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Packaging Analysis | YouTube Dashboard',
  description: 'Analyze title and thumbnail performance for content optimization',
};

export default function PackagingPage() {
  return (
    <div className="flex-1 space-y-6 p-6 bg-background">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Packaging Analysis</h1>
          <p className="text-muted-foreground">
            Analyze title and thumbnail performance to optimize content strategy
          </p>
        </div>
        <ExportButton />
      </div>

      {/* Filters */}
      <div className="bg-card rounded-lg border border-border p-4 shadow-sm">
        <Suspense fallback={<FiltersSkeleton />}>
          <PackagingFilters />
        </Suspense>
      </div>

      {/* Content Grid */}
      <div className="bg-card rounded-lg border border-border p-6 shadow-sm">
        <Suspense fallback={<GridSkeleton />}>
          <PackagingGrid />
        </Suspense>
      </div>
    </div>
  );
}

function FiltersSkeleton() {
  return (
    <div className="flex items-center gap-4">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-10 w-40" />
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {[...Array(12)].map((_, i) => (
        <div key={i} className="bg-card border border-border rounded-lg overflow-hidden">
          <Skeleton className="aspect-video w-full" />
          <div className="p-4 space-y-3">
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-6 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}