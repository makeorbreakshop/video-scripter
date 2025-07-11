'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, Play, Square, RefreshCw } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface ClassificationProgress {
  processed: number;
  total: number;
  failed: number;
  startTime: number;
  currentChunk: number;
  totalChunks: number;
}

export default function AutoClassificationRunner() {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<ClassificationProgress | null>(null);
  const [estimatedTime, setEstimatedTime] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Poll for progress updates
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch('/api/classification/auto-run');
        const data = await response.json();
        
        setIsRunning(data.isRunning);
        setProgress(data.progress);
        setEstimatedTime(data.estimatedTimeRemaining);
        
        // Stop polling if no longer running
        if (!data.isRunning) {
          clearInterval(interval);
        }
      } catch (error) {
        console.error('Error fetching progress:', error);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [isRunning]);

  const startClassification = async (limit?: number) => {
    setIsStarting(true);
    try {
      const response = await fetch('/api/classification/auto-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'start',
          totalLimit: limit 
        }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setIsRunning(true);
        console.log('Classification started:', data);
      } else {
        alert(data.error || 'Failed to start classification');
      }
    } catch (error) {
      console.error('Error starting classification:', error);
      alert('Failed to start classification');
    } finally {
      setIsStarting(false);
    }
  };

  const stopClassification = async () => {
    try {
      await fetch('/api/classification/auto-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      console.log('Stop signal sent');
    } catch (error) {
      console.error('Error stopping classification:', error);
    }
  };

  const checkStatus = async () => {
    try {
      const response = await fetch('/api/classification/auto-run');
      const data = await response.json();
      
      setIsRunning(data.isRunning);
      setProgress(data.progress);
      setEstimatedTime(data.estimatedTimeRemaining);
    } catch (error) {
      console.error('Error checking status:', error);
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
        <CardTitle>🤖 Auto Classification Runner</CardTitle>
        <CardDescription>
          Automatically classify all unprocessed videos with rate limiting and error handling
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isRunning && !progress && (
          <div className="grid grid-cols-2 gap-4">
            <Button 
              onClick={() => startClassification(1000)}
              disabled={isStarting}
              variant="outline"
            >
              {isStarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Test Run (1,000 videos)
            </Button>
            <Button 
              onClick={() => startClassification(10000)}
              disabled={isStarting}
              variant="outline"
            >
              {isStarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Medium Run (10,000 videos)
            </Button>
            <Button 
              onClick={() => startClassification()}
              disabled={isStarting}
              className="col-span-2"
            >
              {isStarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Play className="mr-2 h-4 w-4" />
              Full Classification Run (All Videos)
            </Button>
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
                  onClick={stopClassification}
                  variant="destructive"
                  size="sm"
                >
                  <Square className="mr-2 h-4 w-4" />
                  Stop Classification
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