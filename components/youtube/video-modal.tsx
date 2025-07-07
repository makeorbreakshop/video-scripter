'use client';

import { useState, useMemo } from 'react';
import Image from 'next/image';
import { Calendar, Eye, Users, ExternalLink, Target, TrendingUp, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PerformanceBadge } from './performance-badge';
import { formatViewCount } from '@/lib/utils';
import { cn } from '@/lib/utils';

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

// Context-specific data
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

interface VideoModalProps {
  video: VideoData;
  context: VideoContext;
  isOpen: boolean;
  onClose: () => void;
}

export function VideoModal({ video, context, isOpen, onClose }: VideoModalProps) {
  const [imageError, setImageError] = useState(!video.thumbnail_url || video.thumbnail_url.trim() === '');

  // Memoized calculations
  const publishedDate = useMemo(() => {
    return new Date(video.published_at).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [video.published_at]);

  const formattedViewCount = useMemo(() => {
    return formatViewCount(video.view_count);
  }, [video.view_count]);

  const handleYouTubeLink = () => {
    window.open(`https://youtube.com/watch?v=${video.id}`, '_blank');
  };

  const renderContextOverlay = () => {
    if (context.type === 'packaging') {
      const formattedBaseline = formatViewCount(context.baseline_views);
      const formattedChannelAvg = context.channel_avg_views ? formatViewCount(context.channel_avg_views) : null;
      
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <PerformanceBadge percentage={context.performance_ratio} />
            <span className="text-sm font-medium">Performance vs Baseline</span>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Video Performance</div>
              <div className="text-2xl font-bold">{formattedViewCount}</div>
              <div className="text-sm text-muted-foreground">Total views</div>
            </div>
            
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Rolling Baseline</div>
              <div className="text-2xl font-bold">{formattedBaseline}</div>
              <div className="text-sm text-muted-foreground">Previous year average</div>
            </div>
          </div>
          
          {formattedChannelAvg && (
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Channel Average</div>
                <div className="text-sm text-muted-foreground">{formattedChannelAvg} views</div>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (context.type === 'search') {
      const similarityPercentage = Math.round(context.similarity_score * 100);
      
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-200">
              <Target className="h-3 w-3 mr-1" />
              {similarityPercentage}% Match
            </Badge>
            <span className="text-sm font-medium">Semantic Similarity</span>
          </div>
          
          {context.search_query && (
            <div className="p-3 bg-muted rounded-lg">
              <div className="text-sm font-medium text-muted-foreground mb-1">Search Query</div>
              <div className="text-sm">"{context.search_query}"</div>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Video Performance</div>
              <div className="text-2xl font-bold">{formattedViewCount}</div>
              <div className="text-sm text-muted-foreground">Total views</div>
            </div>
            
            <div className="space-y-2">
              <div className="text-sm font-medium text-muted-foreground">Similarity Score</div>
              <div className="text-2xl font-bold text-green-600">{similarityPercentage}%</div>
              <div className="text-sm text-muted-foreground">Semantic match</div>
            </div>
          </div>
          
          {context.performance_ratio !== undefined && (
            <div className="flex items-center gap-2">
              <PerformanceBadge percentage={context.performance_ratio} />
              <span className="text-sm text-muted-foreground">Performance vs baseline</span>
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-left line-clamp-2 pr-8">
            {video.title}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Video Thumbnail */}
          <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
            {!imageError && video.thumbnail_url && video.thumbnail_url.trim() !== '' ? (
              <Image
                src={video.thumbnail_url}
                alt={video.title}
                fill
                className="object-cover"
                onError={() => setImageError(true)}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <div className="text-center text-muted-foreground">
                  <div className="text-4xl mb-2">📺</div>
                  <p>Thumbnail unavailable</p>
                </div>
              </div>
            )}
          </div>

          {/* Channel Info */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              {video.is_competitor ? (
                <Users className="h-5 w-5 text-muted-foreground" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-blue-500"></div>
              )}
            </div>
            <div>
              <div className="font-medium">
                {video.channel_name || (video.is_competitor ? video.channel_id : 'Make or Break Shop')}
              </div>
              <div className="text-sm text-muted-foreground flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {publishedDate}
                </span>
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {formattedViewCount} views
                </span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Context-specific content */}
          {renderContextOverlay()}

          <Separator />

          {/* Actions */}
          <div className="flex justify-between items-center">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button onClick={handleYouTubeLink} className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4" />
              Watch on YouTube
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}