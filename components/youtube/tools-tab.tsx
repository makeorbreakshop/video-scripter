/**
 * YouTube Tools Tab Component
 * 
 * Contains advanced tools for YouTube analytics including:
 * - Historical data backfill
 * - Data validation
 * - Connection testing
 * - Bulk operations
 */

'use client';

import React, { useState } from 'react';
import { useAnalyticsProgress } from '@/hooks/use-analytics-progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { 
  Database, 
  Download, 
  CheckCircle, 
  AlertTriangle, 
  Clock, 
  BarChart3, 
  Settings, 
  Play,
  Pause,
  RefreshCw,
  FileText,
  Key
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { isAuthenticated, initiateOAuthFlow, getValidAccessToken, getTokens } from '@/lib/youtube-oauth';

interface BackfillProgress {
  isRunning: boolean;
  totalDays: number;
  processedDays: number;
  successfulDays: number;
  failedDays: number;
  currentDateRange: string;
  recordsProcessed: number;
  totalViews: number;
  quotaUsed: number;
  errors: string[];
  estimatedTimeRemaining: string;
}

interface BaselineProgress {
  isRunning: boolean;
  totalVideos: number;
  processedVideos: number;
  successfulVideos: number;
  failedVideos: number;
  currentVideo: string;
  quotaUsed: number;
  errors: string[];
  estimatedTimeRemaining: string;
}

export function YouTubeToolsTab() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [existingDates, setExistingDates] = useState<string[]>([]);
  const [gapAnalysis, setGapAnalysis] = useState<any>(null);
  const [dataCoverage, setDataCoverage] = useState<any>(null);
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [videoCount, setVideoCount] = useState<number | null>(null);
  const [isBackfillRunning, setIsBackfillRunning] = useState(false);
  const [currentOperationId, setCurrentOperationId] = useState<string | null>(null);
  const [backfillProgress, setBackfillProgress] = useState<BackfillProgress>({
    isRunning: false,
    totalDays: 0,
    processedDays: 0,
    successfulDays: 0,
    failedDays: 0,
    currentDateRange: '',
    recordsProcessed: 0,
    totalViews: 0,
    quotaUsed: 0,
    errors: [],
    estimatedTimeRemaining: ''
  });
  const [validationResults, setValidationResults] = useState<any>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isDownloadingCsv, setIsDownloadingCsv] = useState(false);
  const [isBaselineRunning, setIsBaselineRunning] = useState(false);
  const [baselineProgress, setBaselineProgress] = useState<BaselineProgress>({
    isRunning: false,
    totalVideos: 0,
    processedVideos: 0,
    successfulVideos: 0,
    failedVideos: 0,
    currentVideo: '',
    quotaUsed: 0,
    errors: [],
    estimatedTimeRemaining: ''
  });
  const [baselineSummary, setBaselineSummary] = useState<any>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResults, setConnectionTestResults] = useState<any>(null);

  // Use unified progress tracking
  const { progress: unifiedProgress, startPolling, stopPolling } = useAnalyticsProgress(currentOperationId, isBackfillRunning);

  /**
   * Fetch video count for quota calculations
   */
  const fetchVideoCount = async () => {
    try {
      const response = await fetch('/api/youtube/analytics/video-count');
      if (response.ok) {
        const data = await response.json();
        setVideoCount(data.count);
      }
    } catch (error) {
      console.error('Failed to fetch video count:', error);
    }
  };

  /**
   * Fetch existing dates and gap analysis from daily_analytics table
   */
  const fetchExistingDates = async () => {
    try {
      const response = await fetch('/api/youtube/analytics/existing-dates');
      if (response.ok) {
        const data = await response.json();
        setExistingDates(data.dates);
        setGapAnalysis(data.gapAnalysis);
        setDataCoverage(data.dataCoverage);
        
        // Auto-fill recommended range if available
        if (data.gapAnalysis?.recommendedRange && !startDate && !endDate) {
          setStartDate(data.gapAnalysis.recommendedRange.startDate);
          setEndDate(data.gapAnalysis.recommendedRange.endDate);
        }
      }
    } catch (error) {
      console.error('Failed to fetch existing dates:', error);
    }
  };


  /**
   * Start historical data backfill
   */
  const handleStartBackfill = async () => {
    // Check if user is authenticated first
    if (!isAuthenticated()) {
      toast({
        title: 'Authentication required',
        description: 'Please authenticate with YouTube first using the "Authenticate" button.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsBackfillRunning(true);
      const daysBetween = startDate && endDate ? Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1 : 0;
      
      setBackfillProgress({
        isRunning: true,
        totalDays: daysBetween,
        processedDays: 0,
        successfulDays: 0,
        failedDays: 0,
        currentDateRange: '',
        recordsProcessed: 0,
        totalViews: 0,
        quotaUsed: 0,
        errors: [],
        estimatedTimeRemaining: 'Calculating...'
      });

      toast({
        title: 'Starting historical backfill',
        description: `Processing ${daysBetween} days from ${startDate} to ${endDate}. This may take several minutes.`,
      });

      // Get valid access token and refresh token
      const { getValidAccessToken, getTokens } = await import('@/lib/youtube-oauth');
      const accessToken = await getValidAccessToken();
      const tokens = getTokens();
      
      if (!accessToken) {
        throw new Error('Unable to get valid access token');
      }

      // Start the Analytics API backfill process
      const response = await fetch('/api/youtube/analytics/historical-backfill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          startDate,
          endDate,
          refreshToken: tokens?.refresh_token
        })
      });

      if (!response.ok) {
        throw new Error(`Backfill failed: ${response.status}`);
      }

      // Get operation ID from response for unified progress tracking
      const result = await response.json();
      if (result.success && result.operationId) {
        setCurrentOperationId(result.operationId);
        startPolling();
        
        toast({
          title: 'Backfill started! 🚀',
          description: `Processing ${daysBetween} days with operation ID: ${result.operationId.slice(0, 8)}...`,
        });
      } else {
        throw new Error('Failed to get operation ID from backfill response');
      }

    } catch (error) {
      console.error('Backfill error:', error);
      setIsBackfillRunning(false);
      setBackfillProgress(prev => ({ ...prev, isRunning: false }));
      
      toast({
        title: 'Backfill failed',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    }
  };

  /**
   * Handle unified progress updates from the analytics progress hook
   */
  React.useEffect(() => {
    console.log('🔍 Progress useEffect triggered:', { 
      unifiedProgress, 
      isBackfillRunning, 
      currentOperationId 
    });
    
    if (unifiedProgress && isBackfillRunning) {
      console.log('📊 Updating backfill progress with unified data:', unifiedProgress);
      // Update local state with unified progress data
      setBackfillProgress({
        isRunning: true,
        totalDays: unifiedProgress.totalVideos || 0,
        processedDays: unifiedProgress.processedVideos || 0,
        successfulDays: unifiedProgress.successfulImports || 0,
        failedDays: unifiedProgress.failedImports || 0,
        currentDateRange: unifiedProgress.currentVideo || '',
        recordsProcessed: unifiedProgress.successfulImports || 0,
        totalViews: 0,
        quotaUsed: unifiedProgress.quotaUsed || 0,
        errors: unifiedProgress.errors || [],
        estimatedTimeRemaining: unifiedProgress.estimatedTimeRemaining ? `${Math.round(unifiedProgress.estimatedTimeRemaining / 60)} minutes` : 'Calculating...'
      });

      // Check if operation completed
      if (unifiedProgress.processedVideos >= unifiedProgress.totalVideos) {
        setIsBackfillRunning(false);
        setCurrentOperationId(null);
        stopPolling();
        
        if (unifiedProgress.failedImports === 0) {
          toast({
            title: 'Backfill complete! 🎉',
            description: `Successfully processed ${unifiedProgress.successfulImports} videos, imported ${unifiedProgress.successfulImports.toLocaleString()} records`,
          });
        } else {
          toast({
            title: 'Backfill completed with errors',
            description: `Processed ${unifiedProgress.successfulImports}/${unifiedProgress.totalVideos} videos with ${unifiedProgress.failedImports} errors`,
            variant: 'destructive',
          });
        }
      }
    }
  }, [unifiedProgress, isBackfillRunning, stopPolling]);

  /**
   * Stop Analytics API backfill process
   */
  const handleStopBackfill = async () => {
    try {
      await fetch('/api/youtube/analytics/historical-backfill', { method: 'DELETE' });
      setIsBackfillRunning(false);
      setCurrentOperationId(null);
      stopPolling();
      setBackfillProgress(prev => ({ ...prev, isRunning: false }));
      
      toast({
        title: 'Backfill stopped',
        description: 'The backfill process has been stopped and progress saved.',
      });
    } catch (error) {
      console.error('Stop backfill error:', error);
    }
  };

  /**
   * Download CSV data from last backfill
   */
  const handleDownloadCsv = async () => {
    try {
      setIsDownloadingCsv(true);
      
      const response = await fetch('/api/youtube/reporting/csv-download');
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to download CSV data');
      }
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to get CSV data');
      }
      
      // Create downloadable file
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { 
        type: 'application/json' 
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `youtube-reporting-csv-data-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: 'CSV data downloaded! 📊',
        description: `Downloaded CSV data for ${result.data.metadata.totalDates} dates. Check your downloads folder.`,
      });
      
    } catch (error) {
      console.error('CSV download error:', error);
      toast({
        title: 'CSV download failed',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsDownloadingCsv(false);
    }
  };

  /**
   * Run data validation
   */
  const handleValidateData = async () => {
    // Check if user is authenticated first
    if (!isAuthenticated()) {
      toast({
        title: 'Authentication required',
        description: 'Please authenticate with YouTube first using the "Authenticate" button.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsValidating(true);
      
      toast({
        title: 'Starting data validation',
        description: 'Comparing Analytics API vs Reporting API data accuracy...',
      });

      const response = await fetch('/api/youtube/reporting/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          daysBack: 7,
          tolerance: 5.0
        })
      });

      if (!response.ok) {
        throw new Error(`Validation failed: ${response.status}`);
      }

      const results = await response.json();
      setValidationResults(results);

      toast({
        title: 'Validation complete',
        description: `Success rate: ${results.successRate}% with ${results.totalComparisons} comparisons`,
      });

    } catch (error) {
      console.error('Validation error:', error);
      toast({
        title: 'Validation failed',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsValidating(false);
    }
  };

  /**
   * Start baseline analytics collection
   */
  const handleStartBaseline = async (testMode = false) => {
    // Check if user is authenticated first
    if (!isAuthenticated()) {
      toast({
        title: 'Authentication required',
        description: 'Please authenticate with YouTube first using the "Authenticate" button.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsBaselineRunning(true);
      setBaselineProgress({
        isRunning: true,
        totalVideos: 0,
        processedVideos: 0,
        successfulVideos: 0,
        failedVideos: 0,
        currentVideo: '',
        quotaUsed: 0,
        errors: [],
        estimatedTimeRemaining: 'Starting...'
      });

      toast({
        title: testMode ? 'Starting test collection' : 'Starting baseline collection',
        description: testMode 
          ? 'Testing with 5 videos. This will take 2-3 minutes.' 
          : 'Collecting lifetime analytics for all videos. This will take 30-45 minutes.',
      });

      // Get valid access token
      const { getValidAccessToken } = await import('@/lib/youtube-oauth');
      const accessToken = await getValidAccessToken();
      
      if (!accessToken) {
        throw new Error('Unable to get valid access token');
      }

      // Start baseline collection
      const response = await fetch('/api/youtube/analytics/baseline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(testMode ? {
          videoIds: ['test'], // Will use first 5 videos from database
          dryRun: false // Set to true if you want to test API calls without saving
        } : {})
      });

      if (!response.ok) {
        throw new Error(`Baseline collection failed: ${response.status}`);
      }

      // Start polling for progress
      pollBaselineProgress();

    } catch (error) {
      console.error('Baseline collection error:', error);
      setIsBaselineRunning(false);
      setBaselineProgress(prev => ({ ...prev, isRunning: false }));
      
      toast({
        title: 'Baseline collection failed',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    }
  };

  /**
   * Poll for baseline collection progress
   */
  const pollBaselineProgress = async () => {
    try {
      const response = await fetch('/api/youtube/analytics/baseline', { method: 'GET' });
      if (response.ok) {
        const result = await response.json();
        setBaselineProgress(result.progress);

        if (result.progress.isRunning) {
          // Continue polling
          setTimeout(pollBaselineProgress, 3000);
        } else {
          // Collection complete
          setIsBaselineRunning(false);
          
          if (result.progress.errors.length === 0) {
            toast({
              title: 'Baseline collection complete! 🎉',
              description: `Successfully collected baselines for ${result.progress.successfulVideos} videos`,
            });
          } else {
            toast({
              title: 'Baseline collection completed with errors',
              description: `Processed ${result.progress.successfulVideos}/${result.progress.totalVideos} videos with ${result.progress.errors.length} errors`,
              variant: 'destructive',
            });
          }

          // Refresh summary after completion
          fetchBaselineSummary();
        }
      }
    } catch (error) {
      console.error('Baseline progress polling error:', error);
    }
  };

  /**
   * Stop baseline collection
   */
  const handleStopBaseline = async () => {
    try {
      await fetch('/api/youtube/analytics/baseline', { method: 'DELETE' });
      setIsBaselineRunning(false);
      setBaselineProgress(prev => ({ ...prev, isRunning: false }));
      
      toast({
        title: 'Baseline collection stopped',
        description: 'The collection process has been stopped.',
      });
    } catch (error) {
      console.error('Stop baseline error:', error);
    }
  };

  /**
   * Fetch baseline summary
   */
  const fetchBaselineSummary = async () => {
    try {
      const response = await fetch('/api/youtube/analytics/baseline', { method: 'PATCH' });
      if (response.ok) {
        const result = await response.json();
        setBaselineSummary(result.summary);
      }
    } catch (error) {
      console.error('Fetch baseline summary error:', error);
    }
  };

  /**
   * Handle authentication
   */
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

  /**
   * Test all Analytics API connections
   */
  const handleTestConnections = async () => {
    // Check if user is authenticated first
    if (!isAuthenticated()) {
      toast({
        title: 'Authentication required',
        description: 'Please authenticate with YouTube first using the "Authenticate" button.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsTestingConnection(true);
      setConnectionTestResults(null);
      
      toast({
        title: 'Testing connections',
        description: 'Running comprehensive tests on authentication, API calls, and database...',
      });

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

      // Run connection tests
      const response = await fetch('/api/youtube/analytics/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Connection test failed: ${response.status}`);
      }

      const results = await response.json();
      setConnectionTestResults(results);

      // Show appropriate toast based on results
      if (results.summary.readyForBackfill) {
        toast({
          title: 'All systems go! ✅',
          description: `${results.summary.passedTests}/5 tests passed. Analytics API backfill is ready to run.`,
        });
      } else if (results.summary.needsRevenueSetup) {
        toast({
          title: 'Core systems working ⚠️',
          description: `${results.summary.passedTests}/5 tests passed. Enable revenue data sharing for full functionality.`,
          variant: 'default',
        });
      } else {
        toast({
          title: 'Issues detected ❌',
          description: `${results.summary.passedTests}/5 tests passed. Check the detailed results below.`,
          variant: 'destructive',
        });
      }

    } catch (error) {
      console.error('Connection test error:', error);
      toast({
        title: 'Connection test failed',
        description: error instanceof Error ? error.message : 'Unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  // Initialize data and set smart default dates
  React.useEffect(() => {
    fetchBaselineSummary();
    fetchVideoCount();
    fetchExistingDates(); // This will auto-fill dates if gap analysis recommends them
  }, []);
  
  // Fallback default dates if no gap analysis suggestions
  React.useEffect(() => {
    if (!gapAnalysis && !startDate && !endDate) {
      // Set default date range to 7 days ago (4-day minimum met)
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      setStartDate(tenDaysAgo.toISOString().split('T')[0]);
      setEndDate(fourDaysAgo.toISOString().split('T')[0]);
    }
  }, [gapAnalysis, startDate, endDate]);

  return (
    <div className="space-y-6">
      {/* Connection Test */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Connection Test
          </CardTitle>
          <CardDescription>
            Test all Analytics API connections without running the full 173-video backfill. Validates authentication, database, and revenue permissions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">
                Run comprehensive tests on authentication, core metrics, revenue access, and database connectivity.
              </p>
            </div>
            <div className="flex gap-2">
              <Button 
                onClick={handleAuthenticate}
                disabled={isTestingConnection}
                variant={isAuthenticated() ? "outline" : "default"}
                className="w-auto"
              >
                <Key className="h-4 w-4 mr-2" />
                {isAuthenticated() ? 'Re-authenticate' : 'Authenticate'}
              </Button>
              <Button 
                onClick={handleTestConnections}
                disabled={!isAuthenticated() || isTestingConnection}
                className="w-auto"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isTestingConnection ? 'animate-spin' : ''}`} />
                {isTestingConnection ? 'Testing...' : 'Test Connections'}
              </Button>
            </div>
          </div>

          {connectionTestResults && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Test Results</h4>
                <Badge variant={
                  connectionTestResults.testResults.overallStatus === 'ALL_SYSTEMS_GO' ? 'default' :
                  connectionTestResults.testResults.overallStatus === 'CORE_WORKING_REVENUE_NEEDS_SETUP' ? 'secondary' :
                  'destructive'
                }>
                  {connectionTestResults.summary.passedTests}/5 Tests Passed
                </Badge>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <div className={`w-2 h-2 rounded-full mt-1.5 ${connectionTestResults.testResults.authenticationTest.success ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div className="flex-1">
                    <span className="font-medium">Authentication: </span>
                    <span className={connectionTestResults.testResults.authenticationTest.success ? 'text-green-600' : 'text-red-600'}>
                      {connectionTestResults.testResults.authenticationTest.success ? 'Passed' : 'Failed'}
                    </span>
                    <p className="text-muted-foreground mt-1">{connectionTestResults.testResults.authenticationTest.details}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <div className={`w-2 h-2 rounded-full mt-1.5 ${connectionTestResults.testResults.videoFetchTest.success ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div className="flex-1">
                    <span className="font-medium">Video Fetch: </span>
                    <span className={connectionTestResults.testResults.videoFetchTest.success ? 'text-green-600' : 'text-red-600'}>
                      {connectionTestResults.testResults.videoFetchTest.success ? 'Passed' : 'Failed'}
                    </span>
                    <p className="text-muted-foreground mt-1">{connectionTestResults.testResults.videoFetchTest.details}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <div className={`w-2 h-2 rounded-full mt-1.5 ${connectionTestResults.testResults.coreMetricsTest.success ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div className="flex-1">
                    <span className="font-medium">Core Metrics: </span>
                    <span className={connectionTestResults.testResults.coreMetricsTest.success ? 'text-green-600' : 'text-red-600'}>
                      {connectionTestResults.testResults.coreMetricsTest.success ? 'Passed' : 'Failed'}
                    </span>
                    <p className="text-muted-foreground mt-1">{connectionTestResults.testResults.coreMetricsTest.details}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <div className={`w-2 h-2 rounded-full mt-1.5 ${connectionTestResults.testResults.revenueMetricsTest.success ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div className="flex-1">
                    <span className="font-medium">Revenue Metrics: </span>
                    <span className={connectionTestResults.testResults.revenueMetricsTest.success ? 'text-green-600' : 'text-red-600'}>
                      {connectionTestResults.testResults.revenueMetricsTest.success ? 'Passed' : 'Failed'}
                    </span>
                    <p className="text-muted-foreground mt-1">{connectionTestResults.testResults.revenueMetricsTest.details}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <div className={`w-2 h-2 rounded-full mt-1.5 ${connectionTestResults.testResults.databaseTest.success ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div className="flex-1">
                    <span className="font-medium">Database: </span>
                    <span className={connectionTestResults.testResults.databaseTest.success ? 'text-green-600' : 'text-red-600'}>
                      {connectionTestResults.testResults.databaseTest.success ? 'Passed' : 'Failed'}
                    </span>
                    <p className="text-muted-foreground mt-1">{connectionTestResults.testResults.databaseTest.details}</p>
                  </div>
                </div>
              </div>

              <div className="border-t pt-3">
                <p className="text-sm font-medium">
                  Overall Status: 
                  <span className={`ml-2 ${
                    connectionTestResults.testResults.overallStatus === 'ALL_SYSTEMS_GO' ? 'text-green-600' :
                    connectionTestResults.testResults.overallStatus === 'CORE_WORKING_REVENUE_NEEDS_SETUP' ? 'text-yellow-600' :
                    'text-red-600'
                  }`}>
                    {connectionTestResults.testResults.overallStatus === 'ALL_SYSTEMS_GO' ? '🟢 Ready for Backfill' :
                     connectionTestResults.testResults.overallStatus === 'CORE_WORKING_REVENUE_NEEDS_SETUP' ? '🟡 Enable Revenue Sharing' :
                     '🔴 Issues Detected'}
                  </span>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tools Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Batch Optimization
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">All</div>
            <p className="text-xs text-muted-foreground">
              Videos in single CSV
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Metrics Coverage
            </CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">30+</div>
            <p className="text-xs text-muted-foreground">
              Comprehensive metrics
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Quota Efficiency
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">2</div>
            <p className="text-xs text-muted-foreground">
              Units per day (all videos)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Historical Data Backfill */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Historical Data Backfill
          </CardTitle>
          <CardDescription>
            Import historical YouTube Reporting API data with comprehensive daily metrics. Uses minimal quota (6-8 units total vs 328+ units with Analytics API).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isBackfillRunning ? (
            <>
              <div className="space-y-6">
                {/* Time Period Selection */}
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-foreground">Select Time Period</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Last 7 days', days: 7, desc: '~1 minute', icon: '📅' },
                      { label: 'Last 14 days', days: 14, desc: '~2 minutes', icon: '📊' },
                      { label: 'Last 30 days', days: 30, desc: '~4 minutes', icon: '📈' },
                      { label: 'Last 60 days', days: 60, desc: '~8 minutes', icon: '🗓️' }
                    ].map((option) => {
                      const optionEndDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                      const optionStartDate = new Date(Date.now() - (option.days + 4) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                      const isSelected = startDate === optionStartDate && endDate === optionEndDate;
                      
                      return (
                        <Button
                          key={option.days}
                          variant={isSelected ? "default" : "outline"}
                          onClick={() => {
                            setStartDate(optionStartDate);
                            setEndDate(optionEndDate);
                          }}
                          className={`h-auto p-4 justify-start ${
                            isSelected ? 'ring-2 ring-primary ring-offset-2' : ''
                          }`}
                        >
                          <div className="flex items-center gap-3 w-full">
                            <span className="text-lg">{option.icon}</span>
                            <div className="text-left">
                              <div className="font-medium text-sm">{option.label}</div>
                              <div className="text-xs opacity-70">{option.desc}</div>
                            </div>
                          </div>
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom Date Range - Collapsible */}
                <div className="space-y-3">
                  <button
                    onClick={() => setShowCustomDate(!showCustomDate)}
                    className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span className={`transform transition-transform ${showCustomDate ? 'rotate-90' : ''}`}>▶</span>
                    Custom Date Range
                  </button>
                  
                  {showCustomDate && (
                    <div className="bg-muted/30 rounded-lg p-4 space-y-4 border">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="start-date" className="text-sm font-medium">Start Date</Label>
                          <Input
                            id="start-date"
                            type="date"
                            value={startDate}
                            max={new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full"
                          />
                          {startDate && (
                            <div className="flex items-center gap-1 text-xs">
                              {existingDates.includes(startDate) ? (
                                <>
                                  <span className="text-green-600">●</span>
                                  <span className="text-green-600">Data exists</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-orange-500">●</span>
                                  <span className="text-orange-500">No data yet</span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="end-date" className="text-sm font-medium">End Date</Label>
                          <Input
                            id="end-date"
                            type="date"
                            value={endDate}
                            max={new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full"
                          />
                          {endDate && (
                            <div className="flex items-center gap-1 text-xs">
                              {existingDates.includes(endDate) ? (
                                <>
                                  <span className="text-green-600">●</span>
                                  <span className="text-green-600">Data exists</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-orange-500">●</span>
                                  <span className="text-orange-500">No data yet</span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded p-2">
                        <span>💡</span>
                        <span>Data must be 4+ days old due to YouTube Analytics API requirements</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Smart Suggestions */}
                {(gapAnalysis || dataCoverage) && (
                  <div className="border rounded-lg overflow-hidden bg-blue-50/50">
                    <div className="bg-blue-100/50 px-4 py-3 border-b border-blue-200/50">
                      <div className="flex items-center gap-2">
                        <span>💡</span>
                        <h4 className="font-medium text-sm text-blue-900">Smart Suggestions</h4>
                      </div>
                    </div>
                    <div className="p-4 space-y-4">
                      
                      {/* Data Coverage Summary */}
                      {dataCoverage && (
                        <div className="space-y-2">
                          <div className="text-sm text-blue-800 font-medium">
                            📊 Data Coverage: {dataCoverage.oldestDate || 'No data'} to {dataCoverage.newestDate || 'No data'}
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="space-y-1">
                              <div className="text-blue-700">
                                <span className="font-medium">{dataCoverage.totalDays}</span> days with data
                              </div>
                              <div className="text-blue-700">
                                <span className="font-medium">{dataCoverage.coveragePercent}%</span> coverage
                              </div>
                            </div>
                            <div className="space-y-1">
                              <div className="text-blue-700">
                                <span className="font-medium">{dataCoverage.daysSinceOldest}</span> days since oldest
                              </div>
                              <div className="text-blue-700">
                                <span className="font-medium">{dataCoverage.missingDays}</span> missing days in range
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Gap Analysis */}
                      {gapAnalysis && (
                        <div className="space-y-2">
                          <div className="text-sm text-blue-800 font-medium">
                            {gapAnalysis.suggestions.primary}
                          </div>
                          <div className="text-xs text-blue-700">
                            {gapAnalysis.suggestions.secondary}
                          </div>
                        </div>
                      )}

                      {/* Backward Fill Recommendation */}
                      {dataCoverage?.backwardFillRecommendation && (
                        <div className="space-y-3 pt-2 border-t border-blue-200">
                          <div className="text-sm text-blue-800 font-medium">
                            🎯 Backward Fill Recommendation
                          </div>
                          <div className="space-y-2">
                            <div className="text-xs text-blue-700">
                              <span className="font-medium">Strategy:</span> {dataCoverage.backwardFillRecommendation.reasoning}
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-xs text-blue-700">
                              <div>
                                <span className="font-medium">Duration:</span> {dataCoverage.backwardFillRecommendation.suggestedDaysBack} days
                              </div>
                              <div>
                                <span className="font-medium">Videos:</span> {dataCoverage.backwardFillRecommendation.estimatedVideos?.toLocaleString()}
                              </div>
                              <div>
                                <span className="font-medium">Target Rate:</span> {dataCoverage.backwardFillRecommendation.utilizationTarget}%
                              </div>
                              <div>
                                <span className="font-medium">Est. Time:</span> ~{dataCoverage.backwardFillRecommendation.estimatedTimeHours}h
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setStartDate(dataCoverage.backwardFillRecommendation.recommendedStartDate);
                                setEndDate(dataCoverage.backwardFillRecommendation.recommendedEndDate);
                              }}
                              className="border-blue-300 text-blue-700 hover:bg-blue-50 w-fit"
                            >
                              <span className="mr-2">⬅️</span>
                              Use Backward Fill: {dataCoverage.backwardFillRecommendation.recommendedStartDate} to {dataCoverage.backwardFillRecommendation.recommendedEndDate}
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Regular Gap Fill */}
                      {gapAnalysis?.recommendedRange && (
                        <div className="space-y-2 pt-2 border-t border-blue-200">
                          <div className="text-sm text-blue-800 font-medium">🔧 Fill Gaps</div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setStartDate(gapAnalysis.recommendedRange.startDate);
                              setEndDate(gapAnalysis.recommendedRange.endDate);
                            }}
                            className="border-blue-300 text-blue-700 hover:bg-blue-50 w-fit"
                          >
                            <span className="mr-2">📅</span>
                            Fill Gap: {gapAnalysis.recommendedRange.startDate} to {gapAnalysis.recommendedRange.endDate}
                          </Button>
                          <div className="text-xs text-blue-600">
                            💭 {gapAnalysis.recommendedRange.reason}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    {startDate && endDate && existingDates.length > 0 && (
                      <>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                          {existingDates.filter(d => d >= startDate && d <= endDate).length} dates with data
                        </span>
                        <span className="text-xs">•</span>
                        <span className="text-xs">Latest: {new Date(Math.max(...existingDates.map(d => new Date(d).getTime()))).toLocaleDateString()}</span>
                      </>
                    )}
                  </div>
                  <Button 
                    onClick={handleStartBackfill} 
                    disabled={!startDate || !endDate || new Date(startDate) > new Date(endDate)}
                    size="lg"
                    className="shadow-sm"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Start Backfill
                  </Button>
                </div>
              </div>

              {startDate && endDate && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-primary/5 px-4 py-3 border-b">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <span>📋</span>
                      Summary
                    </h4>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Duration</div>
                          <div className="text-lg font-semibold">
                            {Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1} days
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Processing Time</div>
                          <div className="text-lg font-semibold text-green-600">
                            ~{Math.round((Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1) * 0.25)} min
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Date Range</div>
                          <div className="text-sm font-medium">
                            {new Date(startDate).toLocaleDateString()} → {new Date(endDate).toLocaleDateString()}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">API Quota</div>
                          <div className="space-y-1">
                            <div className="text-sm font-medium">
                              {Math.ceil((Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1) * (videoCount || 173)).toLocaleString()} units
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {(((Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1) * (videoCount || 173) / 100000) * 100).toFixed(1)}% of daily limit
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">Backfill Progress</h4>
                  <p className="text-sm text-muted-foreground">
                    Processing historical data...
                  </p>
                </div>
                <Button variant="outline" onClick={handleStopBackfill}>
                  <Pause className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{backfillProgress.processedDays} / {backfillProgress.totalDays} days</span>
                </div>
                <Progress 
                  value={backfillProgress.totalDays > 0 ? (backfillProgress.processedDays / backfillProgress.totalDays) * 100 : 0} 
                />
              </div>

              {backfillProgress.currentDateRange && (
                <div className="text-sm">
                  <span className="font-medium">Date range:</span> {backfillProgress.currentDateRange}
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="font-medium text-green-600">{backfillProgress.successfulDays}</span>
                  <p className="text-muted-foreground">Successful</p>
                </div>
                <div>
                  <span className="font-medium text-red-600">{backfillProgress.failedDays}</span>
                  <p className="text-muted-foreground">Failed</p>
                </div>
                <div>
                  <span className="font-medium">{backfillProgress.recordsProcessed.toLocaleString()}</span>
                  <p className="text-muted-foreground">Records</p>
                </div>
                <div>
                  <span className="font-medium">{backfillProgress.quotaUsed}</span>
                  <p className="text-muted-foreground">Quota Used</p>
                </div>
              </div>

              {backfillProgress.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {backfillProgress.errors.length} errors occurred. Latest: {backfillProgress.errors[backfillProgress.errors.length - 1]}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Validation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Data Validation
          </CardTitle>
          <CardDescription>
            Compare Analytics API vs Reporting API data accuracy to ensure data integrity.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm">
                Validates the last 7 days of data comparing both APIs with ±5% tolerance.
              </p>
            </div>
            <Button 
              variant="outline" 
              onClick={handleValidateData}
              disabled={isValidating}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isValidating ? 'animate-spin' : ''}`} />
              {isValidating ? 'Validating...' : 'Run Validation'}
            </Button>
          </div>

          {validationResults && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Validation Results</h4>
                <Badge variant={validationResults.successRate >= 95 ? 'default' : 'destructive'}>
                  {validationResults.successRate}% Success Rate
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="font-medium text-green-600">{validationResults.exactMatches}</span>
                  <p className="text-muted-foreground">Exact Matches</p>
                </div>
                <div>
                  <span className="font-medium text-blue-600">{validationResults.withinTolerance}</span>
                  <p className="text-muted-foreground">Within Tolerance</p>
                </div>
                <div>
                  <span className="font-medium text-red-600">{validationResults.outsideTolerance}</span>
                  <p className="text-muted-foreground">Outside Tolerance</p>
                </div>
                <div>
                  <span className="font-medium">{validationResults.totalComparisons}</span>
                  <p className="text-muted-foreground">Total Compared</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Data quality assessment: {
                  validationResults.successRate >= 95 ? '🟢 Excellent' :
                  validationResults.successRate >= 90 ? '🟡 Good' :
                  validationResults.successRate >= 80 ? '🟠 Acceptable' :
                  '🔴 Needs attention'
                }
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Baseline Analytics Collection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Baseline Analytics Collection
          </CardTitle>
          <CardDescription>
            Collect lifetime cumulative analytics for all videos using Analytics API. One-time establishment of historical baselines (329 quota units).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Baseline Summary */}
          {baselineSummary && (
            <div className="p-4 bg-muted/50 rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Current Baseline Status</h4>
                <Badge variant="outline">
                  {baselineSummary.totalVideos} videos
                </Badge>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="font-medium">{baselineSummary.totalViews?.toLocaleString() || 0}</span>
                  <p className="text-muted-foreground">Total Views</p>
                </div>
                <div>
                  <span className="font-medium">{Math.round((baselineSummary.totalWatchTime || 0) / 60).toLocaleString()}</span>
                  <p className="text-muted-foreground">Watch Hours</p>
                </div>
                <div>
                  <span className="font-medium">{baselineSummary.avgViewsPerVideo?.toLocaleString() || 0}</span>
                  <p className="text-muted-foreground">Avg Views/Video</p>
                </div>
                <div>
                  <span className="font-medium">{baselineSummary.mostRecentBaseline || 'None'}</span>
                  <p className="text-muted-foreground">Latest Baseline</p>
                </div>
              </div>
            </div>
          )}

          {!isBaselineRunning ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">
                    Collect lifetime analytics from video publication date to present. Uses Analytics API for comprehensive historical data.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => handleStartBaseline(true)} className="w-auto">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Test Run (5 videos)
                  </Button>
                  <Button onClick={() => handleStartBaseline(false)} className="w-auto">
                    <Play className="h-4 w-4 mr-2" />
                    Full Collection
                  </Button>
                </div>
              </div>

              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Estimated time:</strong> 30-45 minutes for all videos. 
                  <strong> Quota usage:</strong> ~329 units (1 unit per video via Analytics API).
                  <strong> Data scope:</strong> Lifetime totals from May 15, 2017 → Today.
                </AlertDescription>
              </Alert>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-medium">Baseline Collection Progress</h4>
                  <p className="text-sm text-muted-foreground">
                    Collecting lifetime analytics...
                  </p>
                </div>
                <Button variant="outline" onClick={handleStopBaseline}>
                  <Pause className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Progress</span>
                  <span>{baselineProgress.processedVideos} / {baselineProgress.totalVideos} videos</span>
                </div>
                <Progress 
                  value={baselineProgress.totalVideos > 0 ? (baselineProgress.processedVideos / baselineProgress.totalVideos) * 100 : 0} 
                />
              </div>

              {baselineProgress.currentVideo && (
                <div className="text-sm">
                  <span className="font-medium">Current video:</span> {baselineProgress.currentVideo}
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="font-medium text-green-600">{baselineProgress.successfulVideos}</span>
                  <p className="text-muted-foreground">Successful</p>
                </div>
                <div>
                  <span className="font-medium text-red-600">{baselineProgress.failedVideos}</span>
                  <p className="text-muted-foreground">Failed</p>
                </div>
                <div>
                  <span className="font-medium">{baselineProgress.quotaUsed}</span>
                  <p className="text-muted-foreground">Quota Used</p>
                </div>
                <div>
                  <span className="font-medium">{baselineProgress.estimatedTimeRemaining}</span>
                  <p className="text-muted-foreground">Time Remaining</p>
                </div>
              </div>

              {baselineProgress.errors.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {baselineProgress.errors.length} errors occurred. Latest: {baselineProgress.errors[baselineProgress.errors.length - 1]}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Quick Actions
          </CardTitle>
          <CardDescription>
            Common tools and utilities for YouTube analytics management.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" className="h-20 flex-col">
                  <Download className="h-6 w-6 mb-2" />
                  Export Reports
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Export Analytics Reports</DialogTitle>
                  <DialogDescription>
                    Export comprehensive analytics data with all Reporting API fields including demographics and geography.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <Button className="w-full">
                    Download Complete Dataset (CSV)
                  </Button>
                  <Button variant="outline" className="w-full">
                    Download Demographics Only
                  </Button>
                  <Button variant="outline" className="w-full">
                    Download Traffic Sources Only
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Button 
              variant="outline" 
              className="h-20 flex-col"
              onClick={handleDownloadCsv}
              disabled={isDownloadingCsv}
            >
              <FileText className="h-6 w-6 mb-2" />
              {isDownloadingCsv ? 'Downloading...' : 'Download Raw CSV'}
            </Button>

            <Button variant="outline" className="h-20 flex-col">
              <Database className="h-6 w-6 mb-2" />
              Database Status
            </Button>

            <Button variant="outline" className="h-20 flex-col">
              <BarChart3 className="h-6 w-6 mb-2" />
              Quota Monitor
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}