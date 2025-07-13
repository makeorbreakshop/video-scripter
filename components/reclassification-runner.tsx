'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Loader2, Play, Square, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface ReclassificationProgress {
  processed: number;
  total: number;
  failed: number;
  startTime: number;
  currentChunk: number;
  totalChunks: number;
}

export default function ReclassificationRunner() {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<ReclassificationProgress | null>(null);
  const [estimatedTime, setEstimatedTime] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.8);
  const [videoCount, setVideoCount] = useState<number | null>(null);
  const [isLoadingCount, setIsLoadingCount] = useState(false);

  // Check status on mount and periodically
  useEffect(() => {
    checkStatus();
    fetchVideoCount(confidenceThreshold);
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch video count when threshold changes
  useEffect(() => {
    fetchVideoCount(confidenceThreshold);
  }, [confidenceThreshold]);

  // Poll for progress when running
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch('/api/classification/reclassify-low-confidence');
        const data = await response.json();
        
        setIsRunning(data.isRunning);
        setProgress(data.progress);
        setEstimatedTime(data.estimatedTimeRemaining);
        
        if (!data.isRunning) {
          clearInterval(interval);
        }
      } catch (error) {
        console.error('Error fetching progress:', error);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isRunning]);

  const startReclassification = async () => {
    setIsStarting(true);
    try {
      const response = await fetch('/api/classification/reclassify-low-confidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'start',
          confidenceThreshold 
        }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setIsRunning(true);
        console.log('Reclassification started:', data);
      } else {
        alert(data.error || 'Failed to start reclassification');
      }
    } catch (error) {
      console.error('Error starting reclassification:', error);
      alert('Failed to start reclassification');
    } finally {
      setIsStarting(false);
    }
  };

  const stopReclassification = async () => {
    try {
      await fetch('/api/classification/reclassify-low-confidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      console.log('Stop signal sent');
    } catch (error) {
      console.error('Error stopping reclassification:', error);
    }
  };

  const checkStatus = async () => {
    try {
      const response = await fetch('/api/classification/reclassify-low-confidence');
      const data = await response.json();
      
      setIsRunning(data.isRunning);
      setProgress(data.progress);
      setEstimatedTime(data.estimatedTimeRemaining);
    } catch (error) {
      console.error('Error checking status:', error);
    }
  };

  const fetchVideoCount = async (threshold: number) => {
    setIsLoadingCount(true);
    console.log('Fetching video count for threshold:', threshold);
    try {
      const response = await fetch(`/api/classification/count-low-confidence?threshold=${threshold}`);
      const data = await response.json();
      console.log('Video count response:', data);
      setVideoCount(data.count);
    } catch (error) {
      console.error('Error fetching video count:', error);
    } finally {
      setIsLoadingCount(false);
    }
  };

  const progressPercentage = progress ? (progress.processed / progress.total) * 100 : 0;
  const rate = progress && progress.processed > 0 
    ? progress.processed / ((Date.now() - progress.startTime) / 1000)
    : 0;
  const cost = progress ? progress.processed * 0.000042 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>🔄 Reclassification Runner</CardTitle>
        <CardDescription>
          Reclassify low-confidence videos with updated format categories
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isRunning && !progress && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Confidence Threshold: {(confidenceThreshold * 100).toFixed(0)}%
              </label>
              <Slider
                value={[confidenceThreshold]}
                onValueChange={([value]) => setConfidenceThreshold(value)}
                min={0.5}
                max={0.9}
                step={0.05}
                disabled={isRunning}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Reclassify videos with confidence below this threshold
              </p>
              {(isLoadingCount || videoCount !== null) && (
                <div className="mt-1 space-y-1">
                  <p className="text-sm font-medium">
                    {isLoadingCount ? (
                      <span className="text-muted-foreground">Loading...</span>
                    ) : videoCount !== null ? (
                      <span>Will reclassify {videoCount.toLocaleString()} videos</span>
                    ) : null}
                  </p>
                  {videoCount !== null && videoCount > 0 && !isLoadingCount && (
                    <p className="text-xs text-muted-foreground">
                      Estimated cost: ${(videoCount * 0.000042).toFixed(2)}
                    </p>
                  )}
                </div>
              )}
            </div>
            
            <Button 
              onClick={startReclassification}
              disabled={isStarting || isLoadingCount || videoCount === 0}
              className="w-full"
            >
              {isStarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Play className="mr-2 h-4 w-4" />
              Start Reclassification {videoCount ? `(${videoCount.toLocaleString()} videos)` : ''}
            </Button>
            
            <div className="bg-muted p-3 rounded-lg text-sm">
              <p className="font-medium mb-1">What's new in reclassification:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>5 new format categories added</li>
                <li>live_stream, shorts, vlog, compilation, update</li>
                <li>Better handling of edge cases</li>
                <li>Improved confidence scores expected</li>
              </ul>
            </div>
          </div>
        )}

        {(isRunning || progress) && (
          <>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{progress?.processed.toLocaleString()} / {progress?.total.toLocaleString()}</span>
              </div>
              <Progress value={progressPercentage} className="h-2" />
              <div className="text-xs text-muted-foreground">
                {progressPercentage.toFixed(1)}% complete
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Chunk Progress</div>
                <div className="font-medium">
                  {progress?.currentChunk} / {progress?.totalChunks}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Processing Rate</div>
                <div className="font-medium">{rate.toFixed(1)} videos/sec</div>
              </div>
              <div>
                <div className="text-muted-foreground">Est. Time Remaining</div>
                <div className="font-medium">{estimatedTime || 'Calculating...'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Cost So Far</div>
                <div className="font-medium">${cost.toFixed(2)}</div>
              </div>
              {progress?.failed && progress.failed > 0 && (
                <div className="col-span-2">
                  <div className="text-muted-foreground">Failed Videos</div>
                  <div className="font-medium text-red-600">{progress.failed.toLocaleString()}</div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              {isRunning && (
                <Button 
                  onClick={stopReclassification}
                  variant="destructive"
                  size="sm"
                >
                  <Square className="mr-2 h-4 w-4" />
                  Stop Reclassification
                </Button>
              )}
              <Button 
                onClick={checkStatus}
                variant="outline"
                size="sm"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh Status
              </Button>
            </div>

            {progress?.startTime && (
              <div className="text-xs text-muted-foreground">
                Started {formatDistanceToNow(progress.startTime, { addSuffix: true })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}