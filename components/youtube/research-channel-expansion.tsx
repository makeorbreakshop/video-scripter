'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertCircle, Search } from 'lucide-react';

interface ExpansionResult {
  success: boolean;
  channel_name: string;
  videos_found: number;
  videos_already_existed: number;
  videos_imported: number;
  channel_avg_views: number;
  api_calls_used: number;
  message: string;
}

interface PreviewResult {
  success: boolean;
  channel_name: string;
  videos_found: number;
  videos_already_existed: number;
  videos_to_import: number;
  channel_avg_views: number;
  api_calls_needed: number;
  message: string;
}

interface ChannelVerification {
  success: boolean;
  channel_id: string;
  title: string;
  description: string;
  subscriber_count: number;
  video_count: number;
  thumbnail_url: string;
  handle?: string;
}

// All research channels that could potentially need expansion
const allChannels = [
  'wittworks',
  'Ryan Trahan',
  'Ben Azelart',
  'Simon Squibb',
  'BENOFTHEWEEK',
  'Drew Dirksen',
  'Patrick Zeinali',
  'DavidMC',
  'iNerdSome',
  'Joshua Weissman',
  'SWI Fence',
  'Patrick Cc:',
  'The Angry Explainer',
  'Quadrant',
  'FreestyleMoba',
  'Addie Bowley',
  'Car Care Clues',
  'Angelia Mor',
  'Dylan',
  'Vincent Chan',
  'The Chandler',
  'Make With Miles',
  'Andraz Egart',
  'No The Robot',
  'Practical Engineering',
  'Nikas Rezepte',
  'Shop Nation',
  'The Kelley\'s Country Life',
  'Geek Detour',
  'Colin and Samir'
];

// Manual channel ID mappings to avoid API search costs
const manualChannelIds: Record<string, string> = {
  'I Like To Make Stuff': 'UC6x7GwJxuoABSosgVXDYtTw',
  'Make Something': 'UCtaykeSsGhtn2o2BsPm-rsw', 
  'Fix This Build That': 'UCHYSw4XKO_q1GaChw5pxa-w',
  'wittworks': 'UCGhyz7J9HmS0GT8Y_BR_crA'
};


export function ResearchChannelExpansion() {
  const [channelName, setChannelName] = useState('');
  const [manualChannelId, setManualChannelId] = useState('');
  const [excludeShorts, setExcludeShorts] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ExpansionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<ChannelVerification | null>(null);
  const [channelData, setChannelData] = useState<Array<{name: string, currentVideos: number, hasManualId: boolean, channelId: string, needsExpansion: boolean}>>([]);

  // Load channel data on component mount
  useEffect(() => {
    const loadChannelData = async () => {
      setIsLoadingChannels(true);
      try {
        const response = await fetch('/api/youtube/channel-statuses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channels: allChannels })
        });

        if (response.ok) {
          const statuses = await response.json();
          setChannelData(statuses);
        }
      } catch (err) {
        console.error('Failed to load channel data:', err);
      } finally {
        setIsLoadingChannels(false);
      }
    };

    loadChannelData();
  }, []);

  // Refresh channel data after successful import
  const refreshChannelData = async () => {
    setIsLoadingChannels(true);
    try {
      const response = await fetch('/api/youtube/channel-statuses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: allChannels })
      });

      if (response.ok) {
        const statuses = await response.json();
        setChannelData(statuses);
      }
    } catch (err) {
      console.error('Failed to refresh channel data:', err);
    } finally {
      setIsLoadingChannels(false);
    }
  };

  const handleVerifyChannelId = async () => {
    if (!manualChannelId.trim()) {
      setError('Channel ID is required for verification');
      return;
    }

    setIsVerifying(true);
    setError(null);
    setVerification(null);

    try {
      const response = await fetch('/api/youtube/verify-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: manualChannelId.trim() })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify channel');
      }

      setVerification(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsVerifying(false);
    }
  };

  const handlePreview = async () => {
    if (!channelName.trim()) {
      setError('Channel name is required');
      return;
    }

    setIsPreviewLoading(true);
    setError(null);
    setPreview(null);

    try {
      const response = await fetch('/api/youtube/expand-research-channel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelName: channelName.trim(),
          manualChannelId: manualChannelId.trim() || manualChannelIds[channelName.trim()],
          excludeShorts,
          userId: '00000000-0000-0000-0000-000000000000',
          previewOnly: true
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to preview research channel');
      }

      setPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleExpansion = async () => {
    if (!channelName.trim()) {
      setError('Channel name is required');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/youtube/expand-research-channel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelName: channelName.trim(),
          manualChannelId: manualChannelId.trim() || manualChannelIds[channelName.trim()],
          excludeShorts,
          userId: '00000000-0000-0000-0000-000000000000'
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to expand research channel');
      }

      setResult(data);
      
      // Refresh channel data to update the dropdown
      if (data.success) {
        await refreshChannelData();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-load manual ID and clear other state when channel changes
  const handleChannelChange = (value: string) => {
    setChannelName(value);
    
    // First try to get ID from channelData, then fall back to manual mapping
    const channelInfo = channelData.find(ch => ch.name === value);
    const channelId = channelInfo?.channelId || manualChannelIds[value] || '';
    
    setManualChannelId(channelId);
    setPreview(null);
    setResult(null);
    setError(null);
    setVerification(null);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Research Channel Expansion Test</CardTitle>
          <CardDescription>
            Import the entire video backlog from a research channel to create proper baselines
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="channel-name">Research Channel to Expand</Label>
            <Select value={channelName} onValueChange={handleChannelChange} disabled={isLoading || isPreviewLoading || isLoadingChannels}>
              <SelectTrigger>
                <SelectValue placeholder={isLoadingChannels ? "Loading channels..." : "Select a research channel that needs expansion..."} />
              </SelectTrigger>
              <SelectContent>
                {channelData.map((channel) => (
                  <SelectItem key={channel.name} value={channel.name}>
                    <div className="flex items-center justify-between w-full">
                      <span>{channel.name}</span>
                      <div className="flex items-center gap-2 ml-2">
                        <Badge variant="outline" className="text-xs">
                          {channel.currentVideos} videos
                        </Badge>
                        {channel.hasManualId && (
                          <Badge variant="secondary" className="text-xs">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            ID
                          </Badge>
                        )}
                        {!channel.hasManualId && (
                          <Badge variant="destructive" className="text-xs">
                            No ID
                          </Badge>
                        )}
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isLoadingChannels && channelData.length === 0 && (
              <p className="text-sm text-muted-foreground">
                All channels have been fully imported
              </p>
            )}
          </div>

          {/* Manual Channel ID Input */}
          <div className="space-y-2">
            <Label htmlFor="manual-channel-id">YouTube Channel ID</Label>
            <div className="flex gap-2">
              <Input
                id="manual-channel-id"
                placeholder="UC... (e.g., UCHYSw4XKO_q1GaChw5pxa-w)"
                value={manualChannelId}
                onChange={(e) => setManualChannelId(e.target.value)}
                disabled={isLoading || isPreviewLoading || isVerifying}
              />
              <Button 
                onClick={handleVerifyChannelId} 
                disabled={!manualChannelId.trim() || isVerifying}
                variant="outline"
              >
                {isVerifying ? (
                  <>
                    <Search className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Verify
                  </>
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Find the channel ID by going to the YouTube channel page → View source → Search for "channelId"
            </p>
          </div>

          {/* Channel Verification Display */}
          {verification && (
            <Card className="border-green-500">
              <CardHeader className="pb-2">
                <CardTitle className="text-green-700 text-sm flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Channel Verified
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <img 
                    src={verification.thumbnail_url} 
                    alt={verification.title}
                    className="w-12 h-12 rounded-full object-cover"
                  />
                  <div className="flex-1">
                    <h4 className="font-semibold">{verification.title}</h4>
                    {verification.handle && (
                      <p className="text-sm text-muted-foreground">{verification.handle}</p>
                    )}
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {verification.description}
                    </p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Subscribers:</span> {verification.subscriber_count.toLocaleString()}
                  </div>
                  <div>
                    <span className="font-medium">Videos:</span> {verification.video_count.toLocaleString()}
                  </div>
                  <div className="col-span-2">
                    <span className="font-medium">Channel ID:</span> 
                    <code className="ml-2 text-xs bg-muted px-1 py-0.5 rounded">{verification.channel_id}</code>
                  </div>
                </div>

                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Is this the correct channel?</strong> If yes, proceed with preview/import. 
                    If not, update the Channel ID above.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          )}

          <div className="flex items-center space-x-2">
            <Checkbox
              id="exclude-shorts"
              checked={excludeShorts}
              onCheckedChange={(checked) => setExcludeShorts(checked as boolean)}
              disabled={isLoading || isPreviewLoading}
            />
            <Label htmlFor="exclude-shorts">Exclude YouTube Shorts (videos under 60 seconds)</Label>
          </div>

          <div className="flex space-x-2">
            <Button 
              onClick={handlePreview} 
              disabled={isPreviewLoading || isLoading || !channelName.trim()}
              variant="outline"
              className="flex-1"
            >
              {isPreviewLoading ? 'Previewing...' : 'Preview Import'}
            </Button>
            
            <Button 
              onClick={handleExpansion} 
              disabled={isLoading || isPreviewLoading || !channelName.trim()}
              className="flex-1"
            >
              {isLoading ? 'Importing...' : 'Import Videos'}
            </Button>
          </div>

          {(isLoading || isPreviewLoading) && (
            <div className="space-y-2">
              <Progress value={undefined} className="w-full" />
              <p className="text-sm text-muted-foreground text-center">
                {isPreviewLoading ? 'Previewing videos...' : 'Importing videos and calculating baselines...'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card className="border-blue-500">
          <CardHeader>
            <CardTitle className="text-blue-700">Import Preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="font-medium">{preview.message}</p>
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Channel:</span> {preview.channel_name}
              </div>
              <div>
                <span className="font-medium">Videos Found:</span> {preview.videos_found}
              </div>
              <div>
                <span className="font-medium">Already Exist:</span> {preview.videos_already_existed}
              </div>
              <div>
                <span className="font-medium">Would Import:</span> {preview.videos_to_import}
              </div>
              <div>
                <span className="font-medium">Channel Avg Views:</span> {(preview.channel_avg_views || 0).toLocaleString()}
              </div>
              <div>
                <span className="font-medium">API Calls Needed:</span> {preview.api_calls_needed}
              </div>
            </div>

            {preview.videos_to_import > 0 && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-blue-800 text-sm">
                  ✨ Ready to import {preview.videos_to_import} new videos from "{preview.channel_name}".
                  This will use {preview.api_calls_needed} API calls.
                  {manualChannelIds[channelName.trim()] && (
                    <span className="block mt-1 text-green-700 font-medium">
                      💰 Using manual channel ID - saves 100 API units!
                    </span>
                  )}
                </p>
              </div>
            )}

            {preview.videos_to_import === 0 && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <p className="text-yellow-800 text-sm">
                  ⚠️ No new videos to import. All {preview.videos_found} videos already exist in the database.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className={result.success ? "border-green-500" : "border-yellow-500"}>
          <CardHeader>
            <CardTitle className={result.success ? "text-green-700" : "text-yellow-700"}>
              Expansion Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="font-medium">{result.message}</p>
            
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Channel:</span> {result.channel_name}
              </div>
              <div>
                <span className="font-medium">Videos Found:</span> {result.videos_found}
              </div>
              <div>
                <span className="font-medium">Already Existed:</span> {result.videos_already_existed}
              </div>
              <div>
                <span className="font-medium">Newly Imported:</span> {result.videos_imported}
              </div>
              <div>
                <span className="font-medium">Channel Avg Views:</span> {(result.channel_avg_views || 0).toLocaleString()}
              </div>
              <div>
                <span className="font-medium">API Calls Used:</span> {result.api_calls_used}
              </div>
            </div>

            {result.videos_imported > 0 && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                <p className="text-green-800 text-sm">
                  ✅ Successfully expanded "{result.channel_name}" with {result.videos_imported} new videos!
                  Performance ratios calculated using {(result.channel_avg_views || 0).toLocaleString()} average views.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>• Imports the entire video backlog from the selected research channel</p>
          <p>• Filters out videos that already exist in the database</p>
          <p>• Calculates channel baseline using average views across all found videos</p>
          <p>• Imports new videos with proper performance ratios for packaging analysis</p>
          <p>• Uses 3-8 API calls if channel ID is cached, or 103-108 if channel search is needed</p>
          <p className="font-medium text-amber-600">• Only shows channels that haven't been fully imported yet</p>
          <p className="font-medium text-green-600">• Tracks import status with first import date and refresh tracking</p>
        </CardContent>
      </Card>
    </div>
  );
}