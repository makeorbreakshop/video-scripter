'use client';

import { useState, useMemo, memo, useCallback } from 'react';
import Image from 'next/image';
import { Calendar, Eye, Users, Target } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { PerformanceBadge } from './performance-badge';
import { formatViewCount } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface SearchResult {
  video_id: string;
  title: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
  similarity_score: number;
  thumbnail_url: string;
}

interface SearchResultCardProps {
  result: SearchResult;
}

function SearchResultCardComponent({ result }: SearchResultCardProps) {
  const [imageError, setImageError] = useState(!result.thumbnail_url || result.thumbnail_url.trim() === '');
  const [imageLoading, setImageLoading] = useState(true);

  // Memoize expensive calculations
  const publishedDate = useMemo(() => {
    return new Date(result.published_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, [result.published_at]);

  const formattedViewCount = useMemo(() => {
    return formatViewCount(result.view_count);
  }, [result.view_count]);

  const similarityPercentage = useMemo(() => {
    return Math.round(result.similarity_score * 100);
  }, [result.similarity_score]);

  const performancePercentage = useMemo(() => {
    return result.performance_ratio;
  }, [result.performance_ratio]);

  const handleYouTubeLink = useCallback(() => {
    window.open(`https://youtube.com/watch?v=${result.video_id}`, '_blank');
  }, [result.video_id]);

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
        {!imageError && result.thumbnail_url && result.thumbnail_url.trim() !== '' ? (
          <>
            <Image
              src={result.thumbnail_url}
              alt={result.title}
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
        
        {/* Similarity score overlay */}
        <div className="absolute top-2 left-2 bg-green-600 text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
          <Target className="h-3 w-3" />
          {similarityPercentage}%
        </div>
        
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 rounded-t-lg" />
      </div>

      <CardContent className="p-3 space-y-2">
        {/* Title with Performance Badge */}
        <div className="flex items-start gap-2">
          <h3 className="font-medium text-sm line-clamp-2 text-card-foreground group-hover:text-primary transition-colors leading-tight flex-1">
            {result.title}
          </h3>
          <PerformanceBadge percentage={performancePercentage} />
        </div>

        {/* Channel info with avatar */}
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
            <Users className="h-3 w-3 text-muted-foreground" />
          </div>
          <div className="text-xs text-muted-foreground font-medium min-w-0 truncate">
            {result.channel_name || result.channel_id}
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
export const SearchResultCard = memo(SearchResultCardComponent, (prevProps, nextProps) => {
  // Custom comparison function for shallow comparison of result object
  return (
    prevProps.result.video_id === nextProps.result.video_id &&
    prevProps.result.title === nextProps.result.title &&
    prevProps.result.view_count === nextProps.result.view_count &&
    prevProps.result.published_at === nextProps.result.published_at &&
    prevProps.result.performance_ratio === nextProps.result.performance_ratio &&
    prevProps.result.similarity_score === nextProps.result.similarity_score &&
    prevProps.result.thumbnail_url === nextProps.result.thumbnail_url &&
    prevProps.result.channel_name === nextProps.result.channel_name &&
    prevProps.result.channel_id === nextProps.result.channel_id
  );
});