/**
 * YouTube Tools Page
 * Advanced tools for YouTube analytics and channel management
 */

import { Suspense } from 'react';
import { Metadata } from 'next';
import { YouTubeToolsTab } from '@/components/youtube/tools-tab';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'YouTube Tools | Video Scripter',
  description: 'Advanced tools for YouTube analytics and channel management',
};

export default function YouTubeToolsPage() {
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

      {/* Tools Content */}
      <div className="space-y-6">
        <Suspense fallback={<ToolsSkeleton />}>
          <YouTubeToolsTab />
        </Suspense>
      </div>
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