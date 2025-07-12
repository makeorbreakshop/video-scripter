'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Loader2, Play, Square, RefreshCw, AlertCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface ClassificationProgress {
  processed: number;
  total: number;
  failed: number;
  startTime: number;
  currentChunk: number;
  totalChunks: number;
}

interface DatabaseStatus {
  isLikelyRunning: boolean;
  totalVideos: number;
  classifiedVideos: number;
  unclassifiedVideos: number;
  progressPercentage: number;
  estimatedTimeRemaining: string | null;
  recentActivityCount: number;
  lastClassifiedAt: string | null;
}

export default function AutoClassificationRunner() {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<ClassificationProgress | null>(null);
  const [estimatedTime, setEstimatedTime] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [hasSavedProgress, setHasSavedProgress] = useState(false);
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);

  // Check for existing run on mount and periodically
  useEffect(() => {
    checkStatus();
    checkDatabaseStatus();
    // Check every 5 seconds for status
    const statusInterval = setInterval(() => {
      checkStatus();
      checkDatabaseStatus();
    }, 5000);
    return () => clearInterval(statusInterval);
  }, []);

  // Poll for progress updates more frequently when running
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
      
      // Check if there's saved progress to resume
      if (!data.isRunning && data.progress && data.progress.total > 0 && data.progress.processed < data.progress.total) {
        setHasSavedProgress(true);
      }
    } catch (error) {
      console.error('Error checking status:', error);
    }
  };

  const checkDatabaseStatus = async () => {
    try {
      const response = await fetch('/api/classification/status');
      const data = await response.json();
      setDbStatus(data);
    } catch (error) {
      console.error('Error checking database status:', error);
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
        {/* Show database status if we detect recent activity */}
        {dbStatus?.isLikelyRunning && !isRunning && (
          <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-4 rounded-lg space-y-2 mb-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              <h3 className="font-medium text-yellow-900 dark:text-yellow-100">Classification In Progress</h3>
            </div>
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              Classification appears to be running in another session or was recently active.
            </p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-yellow-700 dark:text-yellow-300">Progress:</span>{' '}
                <span className="font-medium">{dbStatus.classifiedVideos.toLocaleString()} / {dbStatus.totalVideos.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-yellow-700 dark:text-yellow-300">Completion:</span>{' '}
                <span className="font-medium">{dbStatus.progressPercentage.toFixed(1)}%</span>
              </div>
              {dbStatus.estimatedTimeRemaining && (
                <div className="col-span-2">
                  <span className="text-yellow-700 dark:text-yellow-300">Est. Time Remaining:</span>{' '}
                  <span className="font-medium">{dbStatus.estimatedTimeRemaining}</span>
                </div>
              )}
              {dbStatus.lastClassifiedAt && (
                <div className="col-span-2">
                  <span className="text-yellow-700 dark:text-yellow-300">Last Activity:</span>{' '}
                  <span className="font-medium">
                    {formatDistanceToNow(new Date(dbStatus.lastClassifiedAt), { addSuffix: true })}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {!isRunning && !progress && !hasSavedProgress && (
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

        {hasSavedProgress && !isRunning && (
          <div className="space-y-4">
            <div className="bg-muted p-4 rounded-lg">
              <p className="text-sm font-medium mb-2">Previous Run Detected</p>
              <p className="text-sm text-muted-foreground">
                Processed {progress?.processed.toLocaleString()} of {progress?.total.toLocaleString()} videos
              </p>
              <p className="text-sm text-muted-foreground">
                Stopped at chunk {progress?.currentChunk} of {progress?.totalChunks}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Button 
                onClick={async () => {
                  setIsStarting(true);
                  try {
                    const response = await fetch('/api/classification/auto-run', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'resume' }),
                    });
                    
                    if (response.ok) {
                      setIsRunning(true);
                      setHasSavedProgress(false);
                      console.log('Classification resumed');
                    } else {
                      const data = await response.json();
                      alert(data.error || 'Failed to resume classification');
                    }
                  } catch (error) {
                    console.error('Error resuming classification:', error);
                    alert('Failed to resume classification');
                  } finally {
                    setIsStarting(false);
                  }
                }}
                disabled={isStarting}
                className="bg-green-600 hover:bg-green-700"
              >
                {isStarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Play className="mr-2 h-4 w-4" />
                Resume Classification
              </Button>
              <Button 
                onClick={() => startClassification()}
                disabled={isStarting}
                variant="outline"
              >
                {isStarting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Start Fresh (All Videos)
              </Button>
            </div>
          </div>
        )}


        {(isRunning || (progress && !hasSavedProgress)) && (
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