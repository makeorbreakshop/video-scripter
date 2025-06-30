'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Calendar, Eye } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { PerformanceBadge } from './performance-badge';
import { formatViewCount } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface PackagingCardProps {
  video: {
    id: string;
    title: string;
    view_count: number;
    published_at: string;
    baseline_views: number;
    performance_percent: number;
    thumbnail_url: string;
  };
}

export function PackagingCard({ video }: PackagingCardProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  const publishedDate = new Date(video.published_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const handleYouTubeLink = () => {
    window.open(`https://youtube.com/watch?v=${video.id}`, '_blank');
  };

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-all duration-200 cursor-pointer group border-border bg-card" onClick={handleYouTubeLink}>
      <div className="relative aspect-video bg-muted">
        {!imageError ? (
          <>
            <Image
              src={video.thumbnail_url}
              alt={video.title}
              fill
              className={cn(
                'object-cover transition-all duration-200 group-hover:scale-105',
                imageLoading ? 'opacity-0' : 'opacity-100'
              )}
              onLoad={() => setImageLoading(false)}
              onError={() => {
                setImageError(true);
                setImageLoading(false);
              }}
            />
            {imageLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-muted">
            <div className="text-center text-muted-foreground">
              <div className="text-2xl mb-2">📺</div>
              <p className="text-sm">Thumbnail unavailable</p>
            </div>
          </div>
        )}
        
        {/* Performance Badge */}
        <div className="absolute top-3 right-3">
          <PerformanceBadge percentage={video.performance_percent} />
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 rounded-t-lg" />
      </div>

      <CardContent className="p-4 space-y-3">
        {/* Title */}
        <h3 className="font-semibold text-sm line-clamp-2 text-card-foreground group-hover:text-primary transition-colors leading-tight">
          {video.title}
        </h3>

        {/* Metrics */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Eye className="h-3 w-3" />
              <span className="font-medium">{formatViewCount(video.view_count)}</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>{publishedDate}</span>
            </div>
          </div>

          {/* Baseline comparison */}
          <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
            Baseline: {formatViewCount(video.baseline_views)} views
          </div>
        </div>
      </CardContent>
    </Card>
  );
}