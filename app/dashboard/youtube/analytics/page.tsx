/**
 * YouTube Search & Analytics Page
 * Unified search with packaging analysis and semantic search tabs
 */

'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UnifiedSearch } from '@/components/youtube/unified-search';
import { PackagingGrid } from '@/components/youtube/packaging-grid';
import { PackagingFilters } from '@/components/youtube/packaging-filters';
import { SemanticSearch } from '@/components/youtube/semantic-search';
import { Card, CardContent } from '@/components/ui/card';
import { Suspense, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export default function SearchAnalyticsPage() {
  const [activeTab, setActiveTab] = useState('discovery');

  return (
    <div className="flex-1 flex flex-col bg-background min-h-screen">
      <div className="px-4 sm:px-6 py-4">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Search & Analytics</h1>
          <p className="text-muted-foreground">
            Discover videos, analyze packaging performance, and find similar content
          </p>
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full max-w-[600px] grid-cols-3">
            <TabsTrigger value="discovery">Discovery</TabsTrigger>
            <TabsTrigger value="packaging">Packaging Analysis</TabsTrigger>
            <TabsTrigger value="semantic">Semantic Search</TabsTrigger>
          </TabsList>

          {/* Discovery Tab - Unified Search */}
          <TabsContent value="discovery" className="space-y-4">
            <Suspense fallback={<SearchSkeleton />}>
              <UnifiedSearch />
            </Suspense>
          </TabsContent>

          {/* Packaging Analysis Tab */}
          <TabsContent value="packaging" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="p-4">
                <Suspense fallback={<FiltersSkeleton />}>
                  <PackagingFilters />
                </Suspense>
              </CardContent>
            </Card>

            {/* Results Grid */}
            <Suspense fallback={<GridSkeleton />}>
              <PackagingGrid />
            </Suspense>
          </TabsContent>

          {/* Semantic Search Tab */}
          <TabsContent value="semantic" className="space-y-4">
            <Suspense fallback={<SearchSkeleton />}>
              <SemanticSearch />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

function FiltersSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-40" />
      </div>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {[...Array(9)].map((_, i) => (
        <Card key={i}>
          <div className="aspect-video bg-muted animate-pulse" />
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <div className="flex justify-between">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}