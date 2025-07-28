'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, CheckCircle, Upload, TrendingUp, Users, Play, Clock, X, ExternalLink } from 'lucide-react';

interface DiscoveryStats {
  today: {
    channelsDiscovered: number;
    channelsImported: number;
    videosImported: number;
    searchesRun: number;
  };
  quotaStatus: {
    canProceed: boolean;
    remaining: number;
    percentUsed: number;
  };
  readyForNextRun: boolean;
}

export function DiscoveryDashboard() {
  const [stats, setStats] = useState<DiscoveryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runType, setRunType] = useState<'full_run' | 'discovery_only' | 'import_only'>('full_run');
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/youtube/discovery/orchestrator');
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const runDiscovery = async (action: string, dryRun: boolean = false) => {
    setRunning(true);
    setResult(null);

    try {
      const response = await fetch('/api/youtube/discovery/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, dryRun })
      });

      const data = await response.json();
      setResult(data);
      
      // Refresh stats after run
      setTimeout(fetchStats, 2000);
    } catch (error) {
      console.error('Discovery run failed:', error);
      setResult({ error: 'Discovery run failed' });
    } finally {
      setRunning(false);
    }
  };

  const runIndividualMethod = async (method: string) => {
    setRunning(true);
    setResult(null);

    try {
      // Different methods expect different parameters
      let payload: any = {};
      
      if (['featured', 'shelves', 'collaborations'].includes(method)) {
        payload = { 
          sourceChannelIds: ['all'], // Use all imported channels
          excludeExisting: true,
          dryRun: false
        };
      } else if (method === 'comments') {
        payload = {
          videoIds: [], // Will process recent videos  
          maxResults: 50,
          dryRun: false
        };
      } else if (method === 'playlists') {
        payload = {
          channelIds: ['all'],
          maxResults: 50,
          dryRun: false
        };
      } else if (method === 'subscriptions') {
        payload = {
          maxResults: 50,
          dryRun: false
        };
      }

      const response = await fetch(`/api/youtube/discovery/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      setResult({
        method,
        ...data,
        summary: {
          channelsDiscovered: data.channelsDiscovered || data.results?.length || 0,
          channelsApproved: 0,
          channelsImported: 0,
          videosImported: 0,
          executionTimeMs: data.executionTime || 0,
          quotaUsed: data.quotaUsed || 0
        }
      });
      
      // Refresh stats after run
      setTimeout(fetchStats, 2000);
    } catch (error) {
      console.error(`${method} discovery failed:`, error);
      setResult({ error: `${method} discovery failed` });
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Channels Discovered Today</CardTitle>
            <Search className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.today.channelsDiscovered || 0}</div>
            <p className="text-xs text-muted-foreground">
              From {stats?.today.searchesRun || 0} searches
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Channels Imported</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.today.channelsImported || 0}</div>
            <p className="text-xs text-muted-foreground">
              Ready for analysis
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Videos Imported</CardTitle>
            <Upload className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.today.videosImported || 0}</div>
            <p className="text-xs text-muted-foreground">
              Avg {Math.round((stats?.today.videosImported || 0) / Math.max(stats?.today.channelsImported || 1, 1))} per channel
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">API Quota</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.quotaStatus.remaining || 0}</div>
            <div className="h-2 bg-gray-200 rounded-full mt-2">
              <div 
                className="h-2 bg-blue-500 rounded-full"
                style={{ width: `${100 - (stats?.quotaStatus.percentUsed || 0)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {Math.round(100 - (stats?.quotaStatus.percentUsed || 0))}% remaining
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Discovery Controls</CardTitle>
          <CardDescription>
            Run automated channel discovery to find new educational content
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button
              onClick={() => runDiscovery('full_run')}
              disabled={running || !stats?.readyForNextRun}
              className="flex-1"
            >
              {running && runType === 'full_run' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running Full Discovery...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Run Full Discovery
                </>
              )}
            </Button>

            <Button
              onClick={() => runDiscovery('discovery_only')}
              disabled={running || !stats?.readyForNextRun}
              variant="outline"
            >
              Discovery Only
            </Button>

            <Button
              onClick={() => runDiscovery('import_only')}
              disabled={running}
              variant="outline"
            >
              Import Approved
            </Button>

            <Button
              onClick={() => runDiscovery('full_run', true)}
              disabled={running}
              variant="ghost"
            >
              Dry Run
            </Button>
          </div>

          {!stats?.readyForNextRun && (
            <Alert>
              <AlertDescription>
                Insufficient API quota for discovery run. Need at least 2,000 units.
              </AlertDescription>
            </Alert>
          )}

          {result && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <h4 className="font-semibold mb-2">Last Run Results:</h4>
              {result.error ? (
                <p className="text-red-600">{result.error}</p>
              ) : (
                <div className="space-y-2 text-sm">
                  {result.summary && (
                    <>
                      <p>✅ Channels Discovered: {result.summary.channelsDiscovered}</p>
                      <p>✅ Channels Approved: {result.summary.channelsApproved}</p>
                      <p>✅ Channels Imported: {result.summary.channelsImported}</p>
                      <p>✅ Videos Imported: {result.summary.videosImported}</p>
                      <p>⏱️ Execution Time: {Math.round(result.summary.executionTimeMs / 1000)}s</p>
                      <p>📊 Quota Used: {result.summary.quotaUsed} units</p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Individual Discovery Methods</CardTitle>
          <CardDescription>
            Run specific discovery methods independently
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={() => runIndividualMethod('featured')}
              disabled={running}
              variant="outline"
              size="sm"
            >
              <Users className="mr-2 h-4 w-4" />
              Featured Channels
            </Button>
            <Button
              onClick={() => runIndividualMethod('shelves')}
              disabled={running}
              variant="outline"
              size="sm"
            >
              <Play className="mr-2 h-4 w-4" />
              Channel Shelves
            </Button>
            <Button
              onClick={() => runIndividualMethod('comments')}
              disabled={running}
              variant="outline"
              size="sm"
            >
              <Users className="mr-2 h-4 w-4" />
              Comments
            </Button>
            <Button
              onClick={() => runIndividualMethod('collaborations')}
              disabled={running}
              variant="outline"
              size="sm"
            >
              <Users className="mr-2 h-4 w-4" />
              Collaborations
            </Button>
            <Button
              onClick={() => runIndividualMethod('playlists')}
              disabled={running}
              variant="outline"
              size="sm"
            >
              <Play className="mr-2 h-4 w-4" />
              Playlists
            </Button>
            <Button
              onClick={() => runIndividualMethod('subscriptions')}
              disabled={running}
              variant="outline"
              size="sm"
            >
              <Users className="mr-2 h-4 w-4" />
              Subscriptions
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>
            Manage discovery operations and review channels
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => window.location.href = '/dashboard/youtube/discovery?tab=queue'}
            variant="outline"
            className="w-full justify-start"
          >
            <CheckCircle className="mr-2 h-4 w-4" />
            Review Pending Channels
          </Button>
          <Button
            onClick={() => runDiscovery('import_only')}
            disabled={running}
            variant="outline"
            className="w-full justify-start"
          >
            <Upload className="mr-2 h-4 w-4" />
            Import Approved Channels
          </Button>
          <Button
            onClick={() => window.location.href = '/api/youtube/discovery/stats?detailed=true'}
            variant="ghost"
            className="w-full justify-start"
          >
            <TrendingUp className="mr-2 h-4 w-4" />
            View Detailed Analytics
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PendingChannelsQueue() {
  const [channels, setChannels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPendingChannels();
  }, []);

  const loadPendingChannels = async () => {
    try {
      const response = await fetch('/api/youtube/discovery/stats?detailed=true');
      if (response.ok) {
        const data = await response.json();
        // Get pending channels from the detailed stats
        setChannels(data.detailed?.recentDiscoveries?.filter((ch: any) => ch.status === 'pending') || []);
      }
    } catch (error) {
      console.error('Error loading pending channels:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateChannelStatus = async (channelId: string, action: 'approve' | 'reject') => {
    try {
      // Use the orchestrator to update status
      const response = await fetch('/api/youtube/discovery/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'validation_only',
          channelId,
          status: action === 'approve' ? 'approved' : 'rejected'
        })
      });

      if (response.ok) {
        loadPendingChannels();
      }
    } catch (error) {
      console.error('Error updating channel status:', error);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading pending channels...</span>
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No channels pending review. Run discovery to find new channels.
      </div>
    );
  }

  return (
    <div className="space-y-4 max-h-96 overflow-y-auto">
      {channels.slice(0, 10).map((channel) => (
        <div
          key={channel.channelId}
          className="flex items-center justify-between p-3 border rounded-lg bg-background"
        >
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium text-sm">{channel.title || 'Unknown Channel'}</h4>
              <Badge variant="secondary" className="text-xs">
                {channel.status || 'pending'}
              </Badge>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {formatNumber(channel.subscriberCount || 0)} subs
              </div>
              <div className="flex items-center gap-1">
                <Play className="h-3 w-3" />
                {formatNumber(channel.videoCount || 0)} videos
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {channel.discoveryDate ? new Date(channel.discoveryDate).toLocaleDateString() : 'Unknown'}
              </div>
              {channel.score && (
                <div className="text-xs">
                  Score: {channel.score.toFixed(1)}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(`https://youtube.com/channel/${channel.channelId}`, '_blank')}
              className="h-8 w-8 p-0"
            >
              <ExternalLink className="h-3 w-3" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => updateChannelStatus(channel.channelId, 'approve')}
              className="h-8 w-8 p-0 text-green-600 hover:text-green-700 hover:bg-green-50"
            >
              <CheckCircle className="h-3 w-3" />
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => updateChannelStatus(channel.channelId, 'reject')}
              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      ))}
      
      {channels.length > 10 && (
        <div className="text-center pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            Showing 10 of {channels.length} pending channels
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.href = '/dashboard/youtube/discovery?tab=queue'}
            className="mt-2"
          >
            View All Pending
          </Button>
        </div>
      )}
    </div>
  );
}