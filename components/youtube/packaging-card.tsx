'use client';

import { useState, useMemo, memo, useCallback } from 'react';
import Image from 'next/image';
import { Calendar, Eye, Users } from 'lucide-react';
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
    is_competitor?: boolean;
    channel_id?: string;
  };
}

function PackagingCardComponent({ video }: PackagingCardProps) {
  const [imageError, setImageError] = useState(!video.thumbnail_url || video.thumbnail_url.trim() === '');
  const [imageLoading, setImageLoading] = useState(true);

  // Memoize expensive calculations
  const publishedDate = useMemo(() => {
    return new Date(video.published_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, [video.published_at]);

  const formattedViewCount = useMemo(() => {
    return formatViewCount(video.view_count);
  }, [video.view_count]);

  const formattedBaseline = useMemo(() => {
    return formatViewCount(video.baseline_views);
  }, [video.baseline_views]);

  const handleYouTubeLink = useCallback(() => {
    window.open(`https://youtube.com/watch?v=${video.id}`, '_blank');
  }, [video.id]);

  const handleImageLoad = useCallback(() => {
    setImageLoading(false);
  }, []);

  const handleImageError = useCallback(() => {
    setImageError(true);
    setImageLoading(false);
  }, []);

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-all duration-200 cursor-pointer group border-border bg-card" onClick={handleYouTubeLink}>
      <div className="relative aspect-video bg-muted">
        {!imageError && video.thumbnail_url && video.thumbnail_url.trim() !== '' ? (
          <>
            <Image
              src={video.thumbnail_url}
              alt={video.title}
              fill
              className={cn(
                'object-cover transition-all duration-200 group-hover:scale-105',
                imageLoading ? 'opacity-0' : 'opacity-100'
              )}
              onLoad={handleImageLoad}
              onError={handleImageError}
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
        
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 rounded-t-lg" />
      </div>

      <CardContent className="p-3 space-y-2">
        {/* Title with Performance Badge */}
        <div className="flex items-start gap-2">
          <h3 className="font-medium text-sm line-clamp-2 text-card-foreground group-hover:text-primary transition-colors leading-tight flex-1">
            {video.title}
          </h3>
          <PerformanceBadge percentage={video.performance_percent} />
        </div>

        {/* Channel info with avatar */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
            {video.is_competitor ? (
              <Users className="h-3 w-3 text-muted-foreground" />
            ) : (
              <div className="w-4 h-4 rounded-full bg-blue-500"></div>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-medium min-w-0">
            {video.is_competitor ? video.channel_id : 'Make or Break Shop'}
          </div>
        </div>

        {/* Metrics row */}
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{formattedViewCount}</span> • <span>{publishedDate}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// Memoize the component to prevent unnecessary re-renders
export const PackagingCard = memo(PackagingCardComponent, (prevProps, nextProps) => {
  // Custom comparison function for shallow comparison of video object
  return (
    prevProps.video.id === nextProps.video.id &&
    prevProps.video.title === nextProps.video.title &&
    prevProps.video.view_count === nextProps.video.view_count &&
    prevProps.video.published_at === nextProps.video.published_at &&
    prevProps.video.baseline_views === nextProps.video.baseline_views &&
    prevProps.video.performance_percent === nextProps.video.performance_percent &&
    prevProps.video.thumbnail_url === nextProps.video.thumbnail_url &&
    prevProps.video.is_competitor === nextProps.video.is_competitor &&
    prevProps.video.channel_id === nextProps.video.channel_id
  );
});