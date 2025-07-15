/**
 * YouTube Tools Page
 * Advanced tools for YouTube analytics and channel management
 */

"use client"

import { useState } from 'react';
import { Metadata } from 'next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { YouTubeToolsTab } from '@/components/youtube/tools-tab';
import { PatternDiscoveryTab } from '@/components/youtube/pattern-discovery-tab';
import { Skeleton } from '@/components/ui/skeleton';

// Import categorization content from the standalone page
import CategorizationDashboard from '@/app/dashboard/youtube/categorization/page';

export default function YouTubeToolsPage() {
  const [activeTab, setActiveTab] = useState("analytics-tools");

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tools</h1>
          <p className="text-muted-foreground">
            Advanced tools for YouTube analytics and channel management
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="analytics-tools">Analytics Tools</TabsTrigger>
          <TabsTrigger value="categorization">Categorization</TabsTrigger>
          <TabsTrigger value="pattern-discovery">Pattern Discovery</TabsTrigger>
          <TabsTrigger value="data-tools">Data Tools</TabsTrigger>
        </TabsList>

        <TabsContent value="analytics-tools" className="space-y-6">
          <YouTubeToolsTab />
        </TabsContent>

        <TabsContent value="categorization" className="space-y-6">
          <CategorizationDashboard />
        </TabsContent>

        <TabsContent value="pattern-discovery" className="space-y-6">
          <PatternDiscoveryTab />
        </TabsContent>

        <TabsContent value="data-tools" className="space-y-6">
          <div className="text-center py-8 text-muted-foreground">
            Data tools coming soon...
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Loading skeleton component
function ToolsSkeleton() {
  return (
    <div className="space-y-6">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="space-y-4">
          <Skeleton className="h-6 w-48" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}