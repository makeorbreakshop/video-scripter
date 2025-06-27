/**
 * Enhanced Analytics Progress Component
 * 
 * Displays real-time progress for YouTube Analytics operations with:
 * - Rate limit monitoring (720 queries/minute)
 * - Batch processing status
 * - ETA calculation with rate limiting delays
 * - Token refresh status
 * - Quota utilization tracking
 */

'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Clock, 
  Zap, 
  Activity, 
  BarChart3, 
  AlertTriangle, 
  CheckCircle,
  RefreshCw,
  TrendingUp
} from 'lucide-react';

interface AnalyticsProgressProps {
  progress: {
    isRunning: boolean;
    totalVideos?: number;
    processedVideos?: number;
    successfulImports?: number;
    failedImports?: number;
    currentVideo?: string;
    currentBatch?: number;
    totalBatches?: number;
    quotaUsed?: number;
    queriesPerMinute?: number;
    rateLimitStatus?: {
      queriesInCurrentWindow: number;
      windowStartTime: number;
      maxQueriesPerMinute: number;
      recommendedDelay: number;
    };
    completionPercent?: number;
    rateLimitUtilization?: number;
    estimatedTimeRemaining?: number;
    errors?: string[];
    startTime?: number;
    lastUpdateTime?: number;
  };
  operationType?: string;
  className?: string;
}

export function AnalyticsProgress({ progress, operationType = "Analytics Operation", className }: AnalyticsProgressProps) {
  if (!progress.isRunning && !progress.processedVideos) {
    return null;
  }

  const completionPercent = progress.completionPercent || 
    (progress.totalVideos ? (progress.processedVideos || 0) / progress.totalVideos * 100 : 0);
  
  const rateLimitUtilization = progress.rateLimitUtilization || 
    (progress.rateLimitStatus ? 
      (progress.rateLimitStatus.queriesInCurrentWindow / progress.rateLimitStatus.maxQueriesPerMinute * 100) : 0);

  const getRateLimitColor = (utilization: number) => {
    if (utilization > 80) return 'text-red-600 bg-red-100';
    if (utilization > 60) return 'text-yellow-600 bg-yellow-100';
    if (utilization > 40) return 'text-blue-600 bg-blue-100';
    return 'text-green-600 bg-green-100';
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${Math.round(seconds / 3600 * 10) / 10}h`;
  };

  const getEstimatedCompletion = () => {
    if (!progress.estimatedTimeRemaining) return null;
    return new Date(Date.now() + progress.estimatedTimeRemaining * 1000);
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            {progress.isRunning ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4 text-green-600" />
            )}
            {operationType} Progress
          </span>
          <Badge variant={progress.isRunning ? "default" : "secondary"}>
            {progress.isRunning ? "Running" : "Completed"}
          </Badge>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Main Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Overall Progress</span>
            <span className="font-medium">{completionPercent.toFixed(1)}%</span>
          </div>
          <Progress value={completionPercent} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{progress.processedVideos || 0} / {progress.totalVideos || 0} videos</span>
            <span>{progress.successfulImports || 0} successful</span>
          </div>
        </div>

        {/* Current Status */}
        {progress.currentVideo && (
          <div className="text-sm">
            <span className="font-medium">Current: </span>
            <span className="text-muted-foreground">{progress.currentVideo}</span>
          </div>
        )}

        {/* Batch Progress */}
        {progress.currentBatch && progress.totalBatches && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span>Batch Progress</span>
              <span>{progress.currentBatch} / {progress.totalBatches}</span>
            </div>
            <Progress 
              value={(progress.currentBatch / progress.totalBatches) * 100} 
              className="h-1" 
            />
          </div>
        )}

        {/* Rate Limit Monitoring */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4" />
              <span>Rate Limit</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>Queries/min</span>
                <span className={`px-2 py-1 rounded text-xs font-medium ${getRateLimitColor(rateLimitUtilization)}`}>
                  {progress.queriesPerMinute || 0}/720
                </span>
              </div>
              <Progress 
                value={rateLimitUtilization} 
                className="h-1"
              />
              <div className="text-xs text-muted-foreground">
                {rateLimitUtilization.toFixed(1)}% utilization
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4" />
              <span>Quota Used</span>
            </div>
            <div className="text-lg font-bold">{progress.quotaUsed || 0}</div>
            <div className="text-xs text-muted-foreground">
              units consumed
            </div>
          </div>
        </div>

        {/* Timing Information */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="font-medium">Time Remaining</div>
              <div className="text-muted-foreground">
                {progress.estimatedTimeRemaining ? 
                  formatDuration(progress.estimatedTimeRemaining) : 
                  'Calculating...'}
              </div>
            </div>
          </div>
          
          {getEstimatedCompletion() && (
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="font-medium">ETA</div>
                <div className="text-muted-foreground">
                  {getEstimatedCompletion()?.toLocaleTimeString()}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Advanced Rate Limit Info */}
        {progress.rateLimitStatus && (
          <div className="text-xs space-y-1 p-2 bg-muted rounded">
            <div className="font-medium">Rate Limit Details:</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>Current Window: {progress.rateLimitStatus.queriesInCurrentWindow} queries</div>
              <div>Recommended Delay: {(progress.rateLimitStatus.recommendedDelay / 1000).toFixed(1)}s</div>
            </div>
          </div>
        )}

        {/* Errors */}
        {progress.errors && progress.errors.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {progress.errors.length} error(s) occurred. 
              Latest: {progress.errors[progress.errors.length - 1]}
              {progress.errors.length > 1 && (
                <span className="text-xs block mt-1">
                  ... and {progress.errors.length - 1} more
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Performance Stats */}
        {!progress.isRunning && progress.processedVideos && (
          <div className="border-t pt-3 text-xs text-muted-foreground">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="font-medium text-green-600">{progress.successfulImports}</span> successful
              </div>
              <div>
                <span className="font-medium text-red-600">{progress.failedImports || 0}</span> failed
              </div>
              <div>
                <span className="font-medium">{((progress.successfulImports || 0) / (progress.processedVideos || 1) * 100).toFixed(1)}%</span> success rate
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}