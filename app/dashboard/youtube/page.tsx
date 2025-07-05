/**
 * YouTube Dashboard Page
 * Analytics dashboard with tabs for channel and database analytics
 */

'use client';

import { Suspense, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChannelOverviewCards } from '@/components/youtube/channel-overview-cards';
import { AnalyticsDataTable } from '@/components/youtube/analytics-data-table';
import { RefreshButton } from '@/components/youtube/refresh-button';
import { DatabaseStatsCards } from '@/components/youtube/database-stats-cards';

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
        <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
          <TabsTrigger value="channel">My Channel</TabsTrigger>
          <TabsTrigger value="database">Database Stats</TabsTrigger>
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
          {/* Database Overview Cards */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Suspense fallback={<OverviewCardsSkeleton />}>
              <DatabaseStatsCards />
            </Suspense>
          </div>

          {/* Database Metrics Card */}
          <Card>
            <CardHeader>
              <CardTitle>Database Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div className="text-center">
                    <div className="text-2xl font-bold">11,076</div>
                    <div className="text-sm text-muted-foreground">Total Videos</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">162</div>
                    <div className="text-sm text-muted-foreground">Channels</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">85</div>
                    <div className="text-sm text-muted-foreground">RSS Monitored</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

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

