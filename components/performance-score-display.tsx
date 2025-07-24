'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import { getVideoPerformanceComparison } from '@/lib/age-adjusted-performance';

interface PerformanceScoreDisplayProps {
  videoId: string;
  currentScore: number;
  viewCount: number;
  showComparison?: boolean;
}

export function PerformanceScoreDisplay({ 
  videoId, 
  currentScore, 
  viewCount,
  showComparison = true 
}: PerformanceScoreDisplayProps) {
  const [ageAdjustedData, setAgeAdjustedData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (showComparison && videoId) {
      setLoading(true);
      getVideoPerformanceComparison(videoId)
        .then(data => {
          setAgeAdjustedData(data);
          setLoading(false);
        })
        .catch(err => {
          console.error('Error fetching age-adjusted score:', err);
          setLoading(false);
        });
    }
  }, [videoId, showComparison]);

  // Determine color based on old score
  const getOldScoreColor = (score: number) => {
    if (score >= 0.5) return 'text-green-600';
    if (score >= 0) return 'text-yellow-600';
    return 'text-red-600';
  };

  // Determine icon based on performance
  const getPerformanceIcon = () => {
    if (!ageAdjustedData) return null;
    
    if (ageAdjustedData.ageAdjustedScore >= 1.5) {
      return <TrendingUp className="w-4 h-4 text-green-600" />;
    } else if (ageAdjustedData.ageAdjustedScore >= 0.5) {
      return <TrendingDown className="w-4 h-4 text-yellow-600" />;
    } else {
      return <AlertCircle className="w-4 h-4 text-red-600" />;
    }
  };

  return (
    <div className="space-y-2">
      {/* Old Score (Current System) */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Performance:</span>
        <span className={`font-mono text-sm ${getOldScoreColor(currentScore)}`}>
          {currentScore.toFixed(2)}
        </span>
        {currentScore < 0 && (
          <Badge variant="outline" className="text-xs">
            Old System
          </Badge>
        )}
      </div>

      {/* Age-Adjusted Score (New System) */}
      {showComparison && ageAdjustedData && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Age-Adjusted:</span>
          <div className="flex items-center gap-1">
            {getPerformanceIcon()}
            <span className="font-mono text-sm font-medium">
              {ageAdjustedData.ageAdjustedScore}x
            </span>
            <Badge variant="secondary" className="text-xs">
              {ageAdjustedData.performanceTier}
            </Badge>
          </div>
        </div>
      )}

      {/* Additional Context */}
      {showComparison && ageAdjustedData && (
        <div className="text-xs text-muted-foreground">
          {ageAdjustedData.viewsPerDay} views/day 
          (Channel median: {ageAdjustedData.channelMedianVpd})
        </div>
      )}

      {/* Loading State */}
      {showComparison && loading && (
        <div className="text-xs text-muted-foreground animate-pulse">
          Calculating age-adjusted score...
        </div>
      )}
    </div>
  );
}