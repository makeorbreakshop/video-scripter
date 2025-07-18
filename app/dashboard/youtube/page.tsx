/**
 * YouTube Dashboard Page
 * Analytics dashboard with tabs for channel and database analytics
 */

'use client';

import { Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChannelOverviewCards } from '@/components/youtube/channel-overview-cards';
import { AnalyticsDataTable } from '@/components/youtube/analytics-data-table';
import { RefreshButton } from '@/components/youtube/refresh-button';
import { DatabaseStatsCards } from '@/components/youtube/database-stats-cards';
import { DiscoveryStatsCards } from '@/components/youtube/discovery-stats-cards';

export default function YouTubeDashboardPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">
            Channel performance and database metrics
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <RefreshButton />
        </div>
      </div>

      {/* Analytics Tabs */}
      <Tabs defaultValue="channel" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 lg:w-[600px]">
          <TabsTrigger value="channel">My Channel</TabsTrigger>
          <TabsTrigger value="database">Database Stats</TabsTrigger>
          <TabsTrigger value="discovery">Discovery</TabsTrigger>
        </TabsList>

        {/* My Channel Tab */}
        <TabsContent value="channel" className="space-y-6">
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

        {/* Database Stats Tab */}
        <TabsContent value="database" className="space-y-6">
          {/* Database Stats Cards - Only dynamic data */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Suspense fallback={<OverviewCardsSkeleton />}>
              <DatabaseStatsCards />
            </Suspense>
          </div>
        </TabsContent>

        {/* Discovery Tab */}
        <TabsContent value="discovery" className="space-y-6">
          {/* Discovery Overview Cards */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Suspense fallback={<OverviewCardsSkeleton />}>
              <DiscoveryStatsCards />
            </Suspense>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Channel Discovery Dashboard</CardTitle>
              <p className="text-muted-foreground">
                Manage and monitor multi-method channel discovery
              </p>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">
                  Access the full discovery dashboard for detailed analytics and controls
                </p>
                <a 
                  href="/dashboard/youtube/discovery" 
                  className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
                >
                  Open Discovery Dashboard
                </a>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Loading skeleton components
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