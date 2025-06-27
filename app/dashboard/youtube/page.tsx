/**
 * YouTube Dashboard Page
 * Analytics dashboard for Make or Break Shop channel
 */

import { Suspense } from 'react';
import { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChannelOverviewCards } from '@/components/youtube/channel-overview-cards';
import { AnalyticsDataTable } from '@/components/youtube/analytics-data-table';
import { ExportDialog } from '@/components/youtube/export-dialog';
import { RefreshButton } from '@/components/youtube/refresh-button';
import { YouTubeToolsTab } from '@/components/youtube/tools-tab';

export const metadata: Metadata = {
  title: 'YouTube Dashboard | Video Scripter',
  description: 'Analytics dashboard for Make or Break Shop YouTube channel',
};

export default function YouTubeDashboardPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">YouTube Dashboard</h1>
          <p className="text-muted-foreground">
            Analytics for Make or Break Shop channel
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <ExportDialog />
          <RefreshButton />
        </div>
      </div>

      {/* Tabbed Interface */}
      <Tabs defaultValue="analytics" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
        </TabsList>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          {/* Channel Overview Cards */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Suspense fallback={<OverviewCardsSkeleton />}>
              <ChannelOverviewCards />
            </Suspense>
          </div>

          {/* Performance Data Table */}
          <Card>
            <CardHeader>
              <CardTitle>Video Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<DataTableSkeleton />}>
                <AnalyticsDataTable />
              </Suspense>
            </CardContent>
          </Card>

        </TabsContent>

        {/* Tools Tab */}
        <TabsContent value="tools" className="space-y-6">
          <YouTubeToolsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Loading skeleton components following Shadcn patterns
function OverviewCardsSkeleton() {
  return (
    <>
      {[...Array(4)].map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-24 mb-2" />
            <Skeleton className="h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </>
  );
}

function DataTableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="space-y-2">
        {[...Array(10)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}

