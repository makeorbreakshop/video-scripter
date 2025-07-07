'use client';

import { useState, useMemo, memo, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Users, Target, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { PerformanceBadge } from './performance-badge';
import { VideoModal } from './video-modal';
import { formatViewCount } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Unified video interface that works for both packaging and search
interface VideoData {
  id: string;
  title: string;
  view_count: number;
  published_at: string;
  thumbnail_url: string;
  channel_id?: string;
  channel_name?: string;
  is_competitor?: boolean;
}

// Context-specific data for overlays
interface PackagingContext {
  type: 'packaging';
  performance_ratio: number;
  baseline_views: number;
  channel_avg_views?: number;
}

interface SearchContext {
  type: 'search';
  similarity_score: number;
  search_query?: string;
  performance_ratio?: number;
}

type VideoContext = PackagingContext | SearchContext;

interface UnifiedVideoCardProps {
  video: VideoData;
  context: VideoContext;
  onClick?: () => void; // Optional custom onClick handler
}

function UnifiedVideoCardComponent({ video, context, onClick }: UnifiedVideoCardProps) {
  const [imageError, setImageError] = useState(!video.thumbnail_url || video.thumbnail_url.trim() === '');
  const [imageLoading, setImageLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Memoized calculations
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

  // Context-specific calculations
  const contextData = useMemo(() => {
    if (context.type === 'packaging') {
      const channelAverage = context.channel_avg_views || context.baseline_views;
      return {
        performance: context.performance_ratio,
        channelAverage,
        formattedChannelAverage: formatViewCount(channelAverage),
      };
    } else {
      return {
        performance: context.performance_ratio,
        similarityPercentage: Math.round(context.similarity_score * 100),
      };
    }
  }, [context]);

  const handleCardClick = useCallback(() => {
    if (onClick) {
      onClick();
    } else {
      setIsModalOpen(true);
    }
  }, [onClick]);

  const handleImageLoad = useCallback(() => {
    setImageLoading(false);
  }, []);

  const handleImageError = useCallback(() => {
    setImageError(true);
    setImageLoading(false);
  }, []);

  // Render context-specific overlay badge
  const renderOverlayBadge = () => {
    if (context.type === 'search') {
      return (
        <div className="absolute top-2 left-2 bg-green-600 text-white text-xs font-bold px-2 py-1 rounded flex items-center gap-1">
          <Target className="h-3 w-3" />
          {contextData.similarityPercentage}%
        </div>
      );
    }
    return null;
  };

  // Handle channel name click - prevent event bubbling
  const handleChannelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click from firing
  }, []);

  // Render context-specific channel info
  const renderChannelInfo = () => {
    const channelName = video.channel_name || (video.is_competitor ? video.channel_id : 'Make or Break Shop');
    const channelId = video.channel_id || 'make-or-break-shop';
    
    const baseChannelInfo = (
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
          {video.is_competitor ? (
            <Users className="h-3 w-3 text-muted-foreground" />
          ) : (
            <div className="w-4 h-4 rounded-full bg-blue-500"></div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <Link 
            href={`/dashboard/youtube/channels/${encodeURIComponent(channelId)}`}
            onClick={handleChannelClick}
            className="text-xs text-muted-foreground font-medium truncate hover:text-primary transition-colors underline-offset-2 hover:underline"
          >
            {channelName}
          </Link>
          {context.type === 'packaging' && contextData.channelAverage > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <TrendingUp className="h-3 w-3" />
                    <span>{contextData.formattedChannelAverage} avg</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Channel Average: {contextData.formattedChannelAverage} views</p>
                  <p className="text-xs text-muted-foreground">Based on previous year of videos</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    );

    return baseChannelInfo;
  };

  return (
    <>
      <Card className="overflow-hidden hover:shadow-lg transition-all duration-200 cursor-pointer group border-border bg-card" onClick={handleCardClick}>
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
          
          {/* Context-specific overlay badge */}
          {renderOverlayBadge()}
          
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 rounded-t-lg" />
        </div>

        <CardContent className="p-3 space-y-2">
          {/* Title with Performance Badge */}
          <div className="flex items-start gap-2">
            <h3 className="font-medium text-sm line-clamp-2 text-card-foreground group-hover:text-primary transition-colors leading-tight flex-1">
              {video.title}
            </h3>
            {contextData.performance !== undefined && (
              <PerformanceBadge percentage={contextData.performance} />
            )}
          </div>

          {/* Channel info */}
          {renderChannelInfo()}

          {/* Metrics row */}
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{formattedViewCount}</span> • <span>{publishedDate}</span>
          </div>
        </CardContent>
      </Card>

      {/* Modal */}
      <VideoModal
        video={video}
        context={context}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}

// Memoize the component to prevent unnecessary re-renders
export const UnifiedVideoCard = memo(UnifiedVideoCardComponent, (prevProps, nextProps) => {
  const videoEqual = (
    prevProps.video.id === nextProps.video.id &&
    prevProps.video.title === nextProps.video.title &&
    prevProps.video.view_count === nextProps.video.view_count &&
    prevProps.video.published_at === nextProps.video.published_at &&
    prevProps.video.thumbnail_url === nextProps.video.thumbnail_url &&
    prevProps.video.is_competitor === nextProps.video.is_competitor &&
    prevProps.video.channel_id === nextProps.video.channel_id &&
    prevProps.video.channel_name === nextProps.video.channel_name
  );

  // Deep comparison for context (since it's a union type)
  const contextEqual = JSON.stringify(prevProps.context) === JSON.stringify(nextProps.context);

  return videoEqual && contextEqual;
});