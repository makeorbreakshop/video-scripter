/**
 * Refresh Button Component
 * Handles manual analytics data refresh
 */

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { RefreshCw, TestTube, Download, Database, Key, RotateCcw } from 'lucide-react';
import { BackfillProgress } from './types';
import { isAuthenticated, initiateOAuthFlow } from '@/lib/youtube-oauth';

export function RefreshButton() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRefreshingChannel, setIsRefreshingChannel] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [isUserAuthenticated, setIsUserAuthenticated] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [progress, setProgress] = useState<BackfillProgress>({
    total: 0,
    processed: 0,
    currentVideo: '',
    errors: [],
    isRunning: false,
  });

  // Handle authentication state on client side only
  useEffect(() => {
    setIsClient(true);
    setIsUserAuthenticated(isAuthenticated());
  }, []);

  // Update authentication state after OAuth
  useEffect(() => {
    const updateAuthState = () => {
      setIsUserAuthenticated(isAuthenticated());
    };
    
    // Listen for storage changes (when OAuth completes in another tab)
    window.addEventListener('storage', updateAuthState);
    
    return () => {
      window.removeEventListener('storage', updateAuthState);
    };
  }, []);

  const handleRefresh = async () => {
    try {
      // Check if user is authenticated first
      if (!isAuthenticated()) {
        toast({
          title: 'Authentication required',
          description: 'Please authenticate with YouTube first using the "Authenticate" button.',
          variant: 'destructive',
        });
        return;
      }

      setIsRefreshing(true);
      setShowProgress(true);
      setProgress({
        total: 0,
        processed: 0,
        currentVideo: '',
        errors: [],
        isRunning: true,
      });

      // Get valid access token
      const { getValidAccessToken } = await import('@/lib/youtube-oauth');
      const accessToken = await getValidAccessToken();
      
      if (!accessToken) {
        throw new Error('Unable to get valid access token');
      }

      // Start the refresh process
      const response = await fetch('/api/youtube/analytics/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          daysBack: 7, // Refresh last 7 days
        }),
      });

      if (!response.ok) {
        throw new Error('Refresh failed');
      }

      // Poll for progress updates
      const pollProgress = async () => {
        try {
          const progressResponse = await fetch('/api/youtube/analytics/refresh/progress');
          if (progressResponse.ok) {
            const progressData = await progressResponse.json();
            setProgress(progressData);

            if (progressData.isRunning) {
              setTimeout(pollProgress, 1000); // Poll every second
            } else {
              // Refresh complete
              setIsRefreshing(false);
              setShowProgress(false);
              
              if (progressData.errors.length === 0) {
                toast({
                  title: 'Refresh complete',
                  description: `Successfully updated analytics for ${progressData.processed} videos.`,
                });
              } else {
                toast({
                  title: 'Refresh completed with errors',
                  description: `Updated ${progressData.processed} videos with ${progressData.errors.length} errors.`,
                  variant: 'destructive',
                });
              }

              // Trigger page refresh to show new data
              window.location.reload();
            }
          }
        } catch (error) {
          console.error('Error polling progress:', error);
        }
      };

      // Start polling after a short delay
      setTimeout(pollProgress, 1000);

    } catch (error) {
      console.error('Refresh error:', error);
      setIsRefreshing(false);
      setShowProgress(false);
      
      toast({
        title: 'Refresh failed',
        description: 'There was an error refreshing analytics data. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleAuthenticate = async () => {
    try {
      toast({
        title: 'Redirecting to Google OAuth...',
        description: 'You will be redirected to Google to authenticate with YouTube.',
      });
      
      // Initiate OAuth flow
      initiateOAuthFlow();
    } catch (error) {
      console.error('Authentication error:', error);
      toast({
        title: 'Authentication failed',
        description: 'There was an error initiating authentication. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleTestConnection = async () => {
    try {
      // Check if user is authenticated first
      if (!isAuthenticated()) {
        toast({
          title: 'Authentication required',
          description: 'Please authenticate with YouTube first using the "Authenticate" button.',
          variant: 'destructive',
        });
        return;
      }

      setIsTesting(true);

      // Get valid access token
      const { getValidAccessToken } = await import('@/lib/youtube-oauth');
      const accessToken = await getValidAccessToken();
      
      if (!accessToken) {
        toast({
          title: 'Authentication expired',
          description: 'Please re-authenticate with YouTube using the "Authenticate" button.',
          variant: 'destructive',
        });
        return;
      }

      // Test the connection
      const response = await fetch('/api/youtube/analytics/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Connection Test Successful! 🎉',
          description: `Channel: ${result.details.channel.title} | ${result.details.analytics.daysOfData} days of analytics data available`,
        });
      } else {
        toast({
          title: 'Connection Test Failed',
          description: `Error: ${result.error}`,
          variant: 'destructive',
        });
      }

    } catch (error) {
      console.error('Test connection error:', error);
      toast({
        title: 'Test failed',
        description: 'There was an error testing the connection. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleDownloadReport = async () => {
    try {
      // Check if user is authenticated first
      if (!isAuthenticated()) {
        toast({
          title: 'Authentication required',
          description: 'Please authenticate with YouTube first using the "Authenticate" button.',
          variant: 'destructive',
        });
        return;
      }

      setIsDownloading(true);

      // Get valid access token
      const { getValidAccessToken } = await import('@/lib/youtube-oauth');
      const accessToken = await getValidAccessToken();
      
      if (!accessToken) {
        throw new Error('Unable to get valid access token');
      }

      // Download the report
      const response = await fetch('/api/youtube/reporting/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Download failed');
      }

      // Check if it's JSON (error/info) or CSV (actual data)
      const contentType = response.headers.get('content-type');
      
      if (contentType?.includes('text/csv')) {
        // It's a CSV file - trigger download
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'youtube-report.csv';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        toast({
          title: 'Report Downloaded! 📊',
          description: 'CSV report has been downloaded. Check your downloads folder.',
        });
      } else {
        // It's JSON - probably a message about no reports available yet
        const result = await response.json();
        toast({
          title: 'No Reports Available Yet',
          description: result.message || 'Reports are generated daily. Try again tomorrow.',
        });
      }

    } catch (error) {
      console.error('Download report error:', error);
      toast({
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'There was an error downloading the report. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadAllReports = async () => {
    try {
      // Check if user is authenticated first
      if (!isAuthenticated()) {
        toast({
          title: 'Authentication required',
          description: 'Please authenticate with YouTube first using the "Authenticate" button.',
          variant: 'destructive',
        });
        return;
      }

      setIsDownloading(true);

      // Get valid access token
      const { getValidAccessToken } = await import('@/lib/youtube-oauth');
      const accessToken = await getValidAccessToken();
      
      if (!accessToken) {
        throw new Error('Unable to get valid access token');
      }

      toast({
        title: 'Starting bulk download...',
        description: 'This may take a few minutes to download all available reports.',
      });

      // Download all reports
      const response = await fetch('/api/youtube/reporting/download-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Download failed');
      }

      // Check if it's a ZIP file or JSON response
      const contentType = response.headers.get('content-type');
      
      if (contentType?.includes('application/zip')) {
        // It's a ZIP file - trigger download
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `youtube-reports-all-${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        toast({
          title: 'All Reports Downloaded! 📦',
          description: 'ZIP file with all available reports has been downloaded. Check your downloads folder.',
        });
      } else {
        // It's JSON - probably a message about no reports available
        const result = await response.json();
        toast({
          title: 'Download Complete',
          description: result.message || 'All available reports have been processed.',
        });
      }

    } catch (error) {
      console.error('Download all reports error:', error);
      toast({
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'There was an error downloading all reports. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRefreshChannelAnalytics = async () => {
    try {
      // Check if user is authenticated first
      if (!isAuthenticated()) {
        toast({
          title: 'Authentication required',
          description: 'Please authenticate with YouTube first using the "Authenticate" button.',
          variant: 'destructive',
        });
        return;
      }

      setIsRefreshingChannel(true);

      // Get valid access token
      const { getValidAccessToken } = await import('@/lib/youtube-oauth');
      const accessToken = await getValidAccessToken();
      
      if (!accessToken) {
        throw new Error('Unable to get valid access token');
      }

      toast({
        title: 'Starting channel analytics refresh...',
        description: 'Importing new videos and updating baseline analytics for your channel.',
      });

      // Call the unified refresh endpoint
      const response = await fetch('/api/youtube/refresh-channel-analytics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          channelId: 'UCjWkNxpp3UHdEavpM_19--Q' // Actual YouTube channel ID
        }),
      });

      const result = await response.json();

      if (result.success) {
        const { stats } = result;
        toast({
          title: 'Channel Analytics Refresh Complete! 🎉',
          description: `Imported ${stats.newVideos} new videos and updated ${stats.updatedBaselines} baseline analytics. Found ${stats.totalChannelVideos} total videos on your channel.`,
        });

        // Trigger page refresh to show new data
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        toast({
          title: 'Channel refresh failed',
          description: result.message || 'There was an error refreshing your channel analytics.',
          variant: 'destructive',
        });
      }

    } catch (error) {
      console.error('Channel analytics refresh error:', error);
      toast({
        title: 'Refresh failed',
        description: error instanceof Error ? error.message : 'There was an error refreshing channel analytics. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshingChannel(false);
    }
  };


  return (
    <>
      <div className="flex gap-2">
        <Button 
          onClick={handleAuthenticate} 
          disabled={!isClient || isTesting || isRefreshing || isDownloading || isRefreshingChannel}
          variant={isUserAuthenticated ? "outline" : "default"}
        >
          <Key className="h-4 w-4 mr-2" />
          {isUserAuthenticated ? 'Re-authenticate' : 'Authenticate'}
        </Button>

        <Button 
          onClick={handleTestConnection} 
          disabled={!isClient || !isUserAuthenticated || isTesting || isRefreshing || isDownloading || isRefreshingChannel}
          variant="outline"
        >
          <TestTube className={`h-4 w-4 mr-2 ${isTesting ? 'animate-pulse' : ''}`} />
          {isTesting ? 'Testing...' : 'Test Connection'}
        </Button>

        <Button 
          onClick={handleRefreshChannelAnalytics} 
          disabled={!isClient || !isUserAuthenticated || isRefreshingChannel || isRefreshing || isDownloading || isTesting}
          variant="default"
        >
          <Database className={`h-4 w-4 mr-2 ${isRefreshingChannel ? 'animate-pulse' : ''}`} />
          {isRefreshingChannel ? 'Refreshing...' : 'Refresh Channel Analytics'}
        </Button>
        
        <Button 
          onClick={handleDownloadReport} 
          disabled={!isClient || !isUserAuthenticated || isDownloading || isRefreshing || isTesting || isRefreshingChannel}
          variant="outline"
        >
          <Download className={`h-4 w-4 mr-2 ${isDownloading ? 'animate-bounce' : ''}`} />
          {isDownloading ? 'Downloading...' : 'Download Report CSV'}
        </Button>

        <Button 
          onClick={handleDownloadAllReports} 
          disabled={!isClient || !isUserAuthenticated || isDownloading || isRefreshing || isTesting || isRefreshingChannel}
          variant="outline"
        >
          <Download className={`h-4 w-4 mr-2 ${isDownloading ? 'animate-bounce' : ''}`} />
          {isDownloading ? 'Downloading...' : 'Download Sample Reports ZIP'}
        </Button>
        
        <Button 
          onClick={handleRefresh} 
          disabled={!isClient || !isUserAuthenticated || isRefreshing || isTesting || isDownloading || isRefreshingChannel}
          variant="outline"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing...' : 'Legacy Analytics API'}
        </Button>
      </div>

      <Dialog open={showProgress} onOpenChange={setShowProgress}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Refreshing Analytics Data</DialogTitle>
            <DialogDescription>
              Fetching latest analytics data from YouTube. This may take a few minutes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{progress.processed} / {progress.total}</span>
              </div>
              <Progress 
                value={progress.total > 0 ? (progress.processed / progress.total) * 100 : 0} 
                className="w-full" 
              />
            </div>

            {progress.currentVideo && (
              <div className="space-y-1">
                <div className="text-sm font-medium">Currently processing:</div>
                <div className="text-xs text-muted-foreground break-words">
                  {progress.currentVideo}
                </div>
              </div>
            )}

            {progress.errors.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-destructive">
                  Errors ({progress.errors.length}):
                </div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {progress.errors.slice(0, 5).map((error, index) => (
                    <div key={index} className="text-xs text-destructive break-words">
                      {error}
                    </div>
                  ))}
                  {progress.errors.length > 5 && (
                    <div className="text-xs text-muted-foreground">
                      ... and {progress.errors.length - 5} more errors
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {!progress.isRunning && (
            <div className="flex justify-end">
              <Button onClick={() => setShowProgress(false)}>
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}