'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Search, 
  RefreshCw,
  Settings,
  Zap,
  Target,
  Brain,
  TrendingUp,
  AlertCircle
} from 'lucide-react';

export function DiscoverySearchInterface() {
  const [runningDiscovery, setRunningDiscovery] = useState(false);
  const [queryCount, setQueryCount] = useState(10);
  const [queryType, setQueryType] = useState('mixed');
  const [minSubscribers, setMinSubscribers] = useState(5000);
  const [useGooglePSE, setUseGooglePSE] = useState(true);
  const [useClusterInsights, setUseClusterInsights] = useState(true);
  const [pseQuota, setPseQuota] = useState({ used: 0, remaining: 100, total: 100 });
  const [clusterStats, setClusterStats] = useState<any>(null);

  useEffect(() => {
    loadPseQuota();
    loadClusterStats();
  }, []);

  const loadPseQuota = async () => {
    try {
      const response = await fetch('/api/google-pse/quota');
      if (response.ok) {
        const data = await response.json();
        setPseQuota(data.quota);
      }
    } catch (error) {
      console.error('Error loading PSE quota:', error);
    }
  };

  const loadClusterStats = async () => {
    try {
      const response = await fetch('/api/youtube/discovery/cluster-stats');
      if (response.ok) {
        const data = await response.json();
        setClusterStats(data);
      }
    } catch (error) {
      console.error('Error loading cluster stats:', error);
    }
  };

  const runDiscovery = async () => {
    setRunningDiscovery(true);
    try {
      const response = await fetch('/api/youtube/discovery/batch-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queryCount,
          queryType,
          useGooglePSE,
          useClusterInsights,
          minSubscribers
        })
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Discovery completed! Found ${data.summary.totalChannelsFound} channels, added ${data.summary.newChannelsAdded} new ones.`);
        loadPseQuota(); // Refresh quota display
      } else {
        const error = await response.json();
        alert(`Discovery failed: ${error.error}`);
      }
    } catch (error) {
      console.error('Error running discovery:', error);
      alert('Discovery failed. Check console for details.');
    } finally {
      setRunningDiscovery(false);
    }
  };

  const runQuickDiscovery = async (preset: 'quick' | 'smart' | 'trending') => {
    const presets = {
      quick: { queryCount: 5, queryType: 'mixed', minSubscribers: 10000, useClusterInsights: false },
      smart: { queryCount: 25, queryType: 'cluster_aware', minSubscribers: 5000, useClusterInsights: true },
      trending: { queryCount: 15, queryType: 'trending', minSubscribers: 1000, useClusterInsights: true }
    };

    const config = presets[preset];
    setRunningDiscovery(true);

    try {
      const response = await fetch('/api/youtube/discovery/batch-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          useGooglePSE: true
        })
      });

      if (response.ok) {
        const data = await response.json();
        alert(`${preset.charAt(0).toUpperCase() + preset.slice(1)} discovery completed! Found ${data.summary.totalChannelsFound} channels, added ${data.summary.newChannelsAdded} new ones.`);
      }
    } catch (error) {
      console.error('Error running preset discovery:', error);
      alert('Discovery failed. Check console for details.');
    } finally {
      setRunningDiscovery(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Google PSE Quota Status */}
      <Card className={pseQuota.remaining < 10 ? 'border-red-200 bg-red-50' : pseQuota.remaining < 30 ? 'border-yellow-200 bg-yellow-50' : ''}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Google PSE Quota Status
            <Button
              variant="ghost"
              size="sm"
              onClick={loadPseQuota}
              className="ml-auto"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold">
                {pseQuota.remaining} / {pseQuota.total}
              </div>
              <div className="text-sm text-muted-foreground">
                Searches remaining today
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold text-orange-600">
                {pseQuota.used} used
              </div>
              <div className="text-xs text-muted-foreground">
                Resets at midnight PT
              </div>
            </div>
          </div>
          {pseQuota.remaining < 10 && (
            <div className="mt-4 p-3 bg-red-100 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">
                ⚠️ Low quota remaining! Only {pseQuota.remaining} searches left today.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cluster Insights Card */}
      {clusterStats && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Smart Discovery Insights
            </CardTitle>
            <CardDescription>
              AI-powered content gap analysis from your {clusterStats.totalVideos?.toLocaleString() || '0'} videos
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-orange-500 mt-0.5" />
                <div>
                  <div className="font-semibold">{clusterStats.underrepresentedClusters || 0} Gap Topics</div>
                  <div className="text-sm text-muted-foreground">
                    Topics that need more content
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <TrendingUp className="h-5 w-5 text-green-500 mt-0.5" />
                <div>
                  <div className="font-semibold">{clusterStats.growingClusters || 0} Trending Topics</div>
                  <div className="text-sm text-muted-foreground">
                    Fast-growing content areas
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Brain className="h-5 w-5 text-blue-500 mt-0.5" />
                <div>
                  <div className="font-semibold">{clusterStats.totalClusters || 0} Total Topics</div>
                  <div className="text-sm text-muted-foreground">
                    Discovered content categories
                  </div>
                </div>
              </div>
            </div>
            {clusterStats.topGaps && clusterStats.topGaps.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <div className="text-sm font-medium mb-2">Top Content Gaps:</div>
                <div className="text-sm text-muted-foreground">
                  {clusterStats.topGaps.slice(0, 3).map((gap: any, idx: number) => (
                    <div key={idx}>• {gap.name} ({gap.videos} videos)</div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quick Discovery Presets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Quick Discovery
          </CardTitle>
          <CardDescription>
            Pre-configured discovery modes for common use cases
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Button
              variant="outline"
              onClick={() => runQuickDiscovery('quick')}
              disabled={runningDiscovery}
              className="h-auto p-4 flex flex-col items-start gap-2"
            >
              <div className="font-semibold">Quick Scan</div>
              <div className="text-sm text-muted-foreground text-left">
                5 searches • 10K+ subs • Mixed topics
              </div>
            </Button>

            <Button
              variant="outline"
              onClick={() => runQuickDiscovery('smart')}
              disabled={runningDiscovery}
              className="h-auto p-4 flex flex-col items-start gap-2 border-blue-200 hover:bg-blue-50"
            >
              <div className="font-semibold flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Smart Discovery
              </div>
              <div className="text-sm text-muted-foreground text-left">
                25 searches • 5K+ subs • AI-powered gaps
              </div>
            </Button>

            <Button
              variant="outline"
              onClick={() => runQuickDiscovery('trending')}
              disabled={runningDiscovery}
              className="h-auto p-4 flex flex-col items-start gap-2"
            >
              <div className="font-semibold">Trending Search</div>
              <div className="text-sm text-muted-foreground text-left">
                15 searches • 1K+ subs • Trending content
              </div>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Custom Discovery */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Custom Discovery
          </CardTitle>
          <CardDescription>
            Configure your own discovery parameters
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="queryCount">Number of Queries</Label>
                <Input
                  id="queryCount"
                  type="number"
                  value={queryCount}
                  onChange={(e) => setQueryCount(parseInt(e.target.value) || 10)}
                  min="1"
                  max="100"
                  className="mt-1"
                />
                <p className="text-sm text-muted-foreground mt-1">
                  More queries = more channels discovered (uses Google PSE quota)
                </p>
              </div>

              <div>
                <Label htmlFor="queryType">Discovery Strategy</Label>
                <Select value={queryType} onValueChange={setQueryType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mixed">Mixed - Balanced approach</SelectItem>
                    <SelectItem value="cluster_aware">Smart - AI-powered gaps</SelectItem>
                    <SelectItem value="gap_filling">Gap Filling - Fill topic gaps</SelectItem>
                    <SelectItem value="trending">Trending - Latest content</SelectItem>
                    <SelectItem value="cross_topic">Cross Topic - Multi-category</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="minSubscribers">Minimum Subscribers</Label>
                <Input
                  id="minSubscribers"
                  type="number"
                  value={minSubscribers}
                  onChange={(e) => setMinSubscribers(parseInt(e.target.value) || 5000)}
                  min="100"
                  step="1000"
                  className="mt-1"
                />
                <p className="text-sm text-muted-foreground mt-1">
                  Filter channels below this subscriber count
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="useGooglePSE"
                    checked={useGooglePSE}
                    onCheckedChange={(checked) => setUseGooglePSE(checked as boolean)}
                  />
                  <Label htmlFor="useGooglePSE" className="text-sm">
                    Use Google PSE (recommended - saves YouTube API quota)
                  </Label>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="useClusterInsights"
                    checked={useClusterInsights}
                    onCheckedChange={(checked) => setUseClusterInsights(checked as boolean)}
                  />
                  <Label htmlFor="useClusterInsights" className="text-sm">
                    Use AI insights to target content gaps
                  </Label>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t">
            <Button 
              onClick={runDiscovery} 
              disabled={runningDiscovery}
              className="w-full md:w-auto"
            >
              {runningDiscovery ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Running Discovery...
                </>
              ) : (
                <>
                  <Target className="h-4 w-4 mr-2" />
                  Run Custom Discovery
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Discovery Info */}
      <Card>
        <CardHeader>
          <CardTitle>Discovery Methods</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h4 className="font-semibold mb-2">Google PSE Method</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li>• 100 free searches per day</li>
                <li>• No YouTube API quota usage</li>
                <li>• Video-first discovery approach</li>
                <li>• Handle resolution for channel IDs</li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">YouTube API Method</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Uses YouTube API quota (100 units/search)</li>
                <li>• Direct channel metadata access</li>
                <li>• More accurate subscriber counts</li>
                <li>• Batch validation (1 unit per 50 channels)</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}