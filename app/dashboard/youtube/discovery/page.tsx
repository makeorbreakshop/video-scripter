'use client';

import { Suspense } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DiscoveryDashboard } from '@/components/discovery-dashboard';
import { UnifiedReviewQueueOptimized } from '@/components/youtube/unified-review-queue-optimized';
import { DiscoverySettings } from '@/components/youtube/discovery-settings';
import { GooglePSETab } from '@/components/youtube/google-pse-tab';

export default function DiscoveryPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Channel Discovery</h1>
          <p className="text-muted-foreground">
            Multi-method channel discovery system with automated validation
          </p>
        </div>
      </div>

      {/* Discovery Tabs */}
      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-[600px]">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="queue">Review Queue</TabsTrigger>
          <TabsTrigger value="google-pse">Google PSE</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <Suspense fallback={<div>Loading dashboard...</div>}>
            <DiscoveryDashboard />
          </Suspense>
        </TabsContent>

        <TabsContent value="queue">
          <Suspense fallback={<div>Loading review queue...</div>}>
            <UnifiedReviewQueueOptimized />
          </Suspense>
        </TabsContent>

        <TabsContent value="google-pse">
          <Suspense fallback={<div>Loading Google PSE...</div>}>
            <GooglePSETab />
          </Suspense>
        </TabsContent>

        <TabsContent value="settings">
          <Suspense fallback={<div>Loading settings...</div>}>
            <DiscoverySettings />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}