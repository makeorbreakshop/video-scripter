'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Download, 
  ExternalLink,
  Users,
  Video,
  CheckCircle2,
  Loader2
} from 'lucide-react';

interface ApprovedChannel {
  channelId: string;
  channelTitle: string;
  subscriberCount: number;
  videoCount: number;
  readyForImport: boolean;
}

export function ApprovedChannels() {
  const [channels, setChannels] = useState<ApprovedChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState<any>(null);

  useEffect(() => {
    loadApprovedChannels();
  }, []);

  const loadApprovedChannels = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/youtube/discovery/import-approved');
      if (response.ok) {
        const data = await response.json();
        setChannels(data.channels || []);
      } else {
        console.error('Failed to load approved channels');
      }
    } catch (error) {
      console.error('Error loading approved channels:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const importApprovedChannels = async () => {
    if (channels.length === 0) return;
    
    setIsImporting(true);
    setImportResults(null);
    
    try {
      const channelIds = channels.map(c => c.channelId);
      
      const response = await fetch('/api/youtube/discovery/import-approved', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelIds: channelIds,
          userId: 'discovery-system', // This would normally come from session
          maxVideos: 'all',
          timePeriod: 'all',
          excludeShorts: true
        }),
      });

      if (response.ok) {
        const results = await response.json();
        setImportResults(results);
        
        // Refresh the approved channels list (should be empty now)
        await loadApprovedChannels();
      } else {
        const error = await response.json();
        console.error('Import failed:', error);
        setImportResults({ success: false, error: error.error || 'Import failed' });
      }
    } catch (error) {
      console.error('Error importing channels:', error);
      setImportResults({ success: false, error: 'Network error during import' });
    } finally {
      setIsImporting(false);
    }
  };

  const getSubscriberTier = (count: number) => {
    if (count >= 10000000) return { tier: '10M+', color: 'bg-purple-100 text-purple-800' };
    if (count >= 1000000) return { tier: '1M+', color: 'bg-blue-100 text-blue-800' };
    if (count >= 100000) return { tier: '100K+', color: 'bg-green-100 text-green-800' };
    if (count >= 10000) return { tier: '10K+', color: 'bg-yellow-100 text-yellow-800' };
    return { tier: '<10K', color: 'bg-gray-100 text-gray-800' };
  };

  return (
    <div className="space-y-6">
      {/* Import Results */}
      {importResults && (
        <Card className={importResults.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
          <CardHeader>
            <CardTitle className={importResults.success ? 'text-green-800' : 'text-red-800'}>
              {importResults.success ? 'Import Successful!' : 'Import Failed'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {importResults.success ? (
              <div className="space-y-2">
                <p className="text-green-700">{importResults.message}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Channels Processed:</span> {importResults.channelsProcessed}
                  </div>
                  <div>
                    <span className="font-medium">Videos Imported:</span> {importResults.totalVideosImported}
                  </div>
                  <div>
                    <span className="font-medium">Vectorization:</span> {importResults.vectorizationTriggered ? '✅ Triggered' : '❌ Failed'}
                  </div>
                  <div>
                    <span className="font-medium">RSS Monitoring:</span> {importResults.rssChannelsAdded.length} channels
                  </div>
                </div>
                {importResults.errors.length > 0 && (
                  <div className="mt-4">
                    <p className="font-medium text-orange-700">Warnings:</p>
                    <ul className="list-disc list-inside text-sm text-orange-600">
                      {importResults.errors.map((error: string, index: number) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-red-700">{importResults.error}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Approved Channels */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Approved Channels ({channels.length})
            </CardTitle>
            <CardDescription>Channels ready for import into the system</CardDescription>
          </div>
          {channels.length > 0 && (
            <Button 
              onClick={importApprovedChannels}
              disabled={isImporting}
              className="bg-green-600 hover:bg-green-700"
            >
              {isImporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Import All Channels
                </>
              )}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded-lg animate-pulse">
                  <div className="flex-1">
                    <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="h-6 bg-gray-200 rounded w-16"></div>
                    <div className="h-8 bg-gray-200 rounded w-20"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : channels.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>No approved channels awaiting import</p>
              <p className="text-sm">Approve channels from the Review Queue to see them here</p>
            </div>
          ) : (
            <div className="space-y-4">
              {channels.map((channel) => {
                const subTier = getSubscriberTier(channel.subscriberCount);
                return (
                  <div key={channel.channelId} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-medium">{channel.channelTitle}</h3>
                        <Badge className={subTier.color}>{subTier.tier}</Badge>
                        <Badge className="bg-green-100 text-green-800">Ready</Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {channel.subscriberCount?.toLocaleString()} subscribers
                        </span>
                        <span className="flex items-center gap-1">
                          <Video className="h-3 w-3" />
                          {channel.videoCount} videos
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(`https://youtube.com/channel/${channel.channelId}`, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        View
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import Instructions */}
      {channels.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Import Process</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>When you click "Import All Channels", the system will:</p>
              <ol className="list-decimal list-inside space-y-1 ml-4">
                <li>Fetch recent videos from each channel via YouTube API</li>
                <li>Import videos to the database with performance metrics</li>
                <li>Generate title embeddings for semantic search</li>
                <li>Add channels to RSS monitoring for ongoing updates</li>
                <li>Mark discovery entries as "imported"</li>
              </ol>
              <p className="mt-4 font-medium">Default settings: All videos, all time, exclude shorts</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}