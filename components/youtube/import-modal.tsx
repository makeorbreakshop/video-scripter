'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RefreshCw, Upload, ChevronDown, ChevronUp, Calendar, Play } from 'lucide-react';

// Helper function to format numbers
const formatNumber = (num: number) => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
};

interface ChannelImportSettings {
  channelId: string;
  channelName: string;
  totalVideos: number;
  recentVideos: number | null;
  selected: boolean;
  filterMode: 'all' | 'recent';
  loading: boolean;
}

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  channels: Array<{
    discovered_channel_id: string;
    channel_metadata: {
      name?: string;
      title?: string;
    };
    video_count: number;
  }>;
  onImport: (settings: { 
    channelIds: string[], 
    dateFilter: 'all' | 'recent',
    dateRange: number 
  }) => void;
}

export function ImportModal({ isOpen, onClose, channels, onImport }: ImportModalProps) {
  const [globalFilter, setGlobalFilter] = useState<'all' | 'recent' | 'custom'>('recent');
  const [channelSettings, setChannelSettings] = useState<ChannelImportSettings[]>([]);
  const [expandDetails, setExpandDetails] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  
  // Calculate date ranges
  const today = new Date();
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(today.getFullYear() - 3);
  const dateRangeText = `${threeYearsAgo.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} - ${today.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;

  // Initialize channel settings when modal opens
  useEffect(() => {
    if (isOpen && channels.length > 0) {
      setLoading(true);
      setLoadingProgress(0);
      
      const settings: ChannelImportSettings[] = channels.map(channel => ({
        channelId: channel.discovered_channel_id,
        channelName: channel.channel_metadata?.name || channel.channel_metadata?.title || 'Unknown Channel',
        totalVideos: channel.video_count || 0,
        recentVideos: null,
        selected: true,
        filterMode: 'recent',
        loading: true
      }));
      
      setChannelSettings(settings);
      
      // Fetch recent video counts for all channels in parallel
      fetchRecentVideoCounts(settings);
    }
  }, [isOpen, channels]);

  const fetchRecentVideoCounts = async (settings: ChannelImportSettings[]) => {
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
    const publishedAfter = threeYearsAgo.toISOString();
    
    console.log(`Fetching recent counts for ${settings.length} channels...`);

    // Fetch counts in parallel
    const promises = settings.map(async (channel, index) => {
      try {
        console.log(`Fetching count for ${channel.channelName} (${channel.channelId})...`);
        // Call our API endpoint which will use the server-side YouTube API key
        const response = await fetch('/api/youtube/channel-recent-count', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: channel.channelId,
            publishedAfter: publishedAfter
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          const recentCount = data.pageInfo?.totalResults;
          
          // If -1, it means we're skipping the expensive count to save quota
          if (recentCount === -1) {
            console.log(`${channel.channelName}: Skipping count to save quota (would cost 100 units)`);
            // Estimate based on typical channel activity (rough estimate)
            const estimatedRecent = Math.min(Math.floor(channel.totalVideos * 0.3), 150);
            setChannelSettings(prev => prev.map((ch, i) => 
              i === index ? { ...ch, recentVideos: estimatedRecent, loading: false, estimated: true } : ch
            ));
          } else {
            console.log(`${channel.channelName}: ${recentCount} recent videos`);
            setChannelSettings(prev => prev.map((ch, i) => 
              i === index ? { ...ch, recentVideos: recentCount, loading: false } : ch
            ));
          }
          setLoadingProgress(prev => prev + (100 / settings.length));
        } else {
          console.error(`API error for ${channel.channelName}:`, response.status, await response.text());
        }
      } catch (error) {
        console.error(`Error fetching recent count for ${channel.channelName}:`, error);
        setChannelSettings(prev => prev.map((ch, i) => 
          i === index ? { ...ch, recentVideos: 0, loading: false } : ch
        ));
        setLoadingProgress(prev => prev + (100 / settings.length));
      }
    });

    await Promise.all(promises);
    setLoading(false);
  };

  const getSmartDefault = (channel: ChannelImportSettings): 'all' | 'recent' => {
    // If channel has less than 100 videos total, import all
    if (channel.totalVideos < 100) return 'all';
    
    // If more than 70% of videos are recent, import all
    if (channel.recentVideos && channel.recentVideos / channel.totalVideos > 0.7) return 'all';
    
    // Otherwise, just import recent
    return 'recent';
  };

  const calculateTotalVideos = () => {
    return channelSettings.reduce((total, channel) => {
      if (!channel.selected) return total;
      
      if (globalFilter === 'custom') {
        return total + (channel.filterMode === 'all' ? channel.totalVideos : (channel.recentVideos || 0));
      } else if (globalFilter === 'all') {
        return total + channel.totalVideos;
      } else {
        return total + (channel.recentVideos || 0);
      }
    }, 0);
  };

  const calculateApiCalls = (videoCount: number) => {
    return Math.ceil(videoCount / 50);
  };

  const handleGlobalFilterChange = (value: string) => {
    setGlobalFilter(value as 'all' | 'recent' | 'custom');
    
    if (value !== 'custom') {
      // Apply global filter to all channels
      setChannelSettings(prev => prev.map(ch => ({
        ...ch,
        filterMode: value as 'all' | 'recent'
      })));
    }
  };

  const handleImport = () => {
    const selectedChannels = channelSettings.filter(ch => ch.selected);
    
    // Determine the effective filter for import
    const effectiveFilter = globalFilter === 'all' ? 'all' : 'recent';
    
    // Get channel IDs based on filter mode
    const channelIds = selectedChannels.map(ch => ch.channelId);
    
    onImport({
      channelIds,
      dateFilter: effectiveFilter,
      dateRange: 1095 // 3 years
    });
    
    onClose();
  };

  const totalVideos = calculateTotalVideos();
  const apiCalls = calculateApiCalls(totalVideos);
  const selectedCount = channelSettings.filter(ch => ch.selected).length;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import {channels.length} Selected Channel{channels.length !== 1 ? 's' : ''}</DialogTitle>
          <DialogDescription>
            Configure how you want to import videos from the selected channels.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">
                <RefreshCw className="inline h-4 w-4 mr-1 animate-spin" />
                Calculating recent videos...
              </span>
              <span className="text-sm">{Math.round(loadingProgress)}%</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${loadingProgress}%` }}
              />
            </div>
          </div>
        )}

        {!loading && channelSettings.length > 0 && (
          <>
            <div className="space-y-4">
              <div className="bg-secondary/20 border rounded-lg p-4">
                <h3 className="font-semibold mb-3">Import Options</h3>
                <RadioGroup value={globalFilter} onValueChange={handleGlobalFilterChange}>
                  <div className="flex items-center space-x-2 mb-2">
                    <RadioGroupItem value="all" id="all" />
                    <Label htmlFor="all" className="cursor-pointer flex flex-col">
                      <span>Import all videos ({formatNumber(channelSettings.reduce((t, c) => t + c.totalVideos, 0))} videos, ~{calculateApiCalls(channelSettings.reduce((t, c) => t + c.totalVideos, 0))} API calls)</span>
                      <span className="text-xs text-muted-foreground">All time - from channel creation to today</span>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2 mb-2">
                    <RadioGroupItem value="recent" id="recent" />
                    <Label htmlFor="recent" className="cursor-pointer flex flex-col">
                      <span>
                        Import recent only ({formatNumber(channelSettings.reduce((t, c) => t + (c.recentVideos || 0), 0))} videos, ~{calculateApiCalls(channelSettings.reduce((t, c) => t + (c.recentVideos || 0), 0))} API calls) 
                        <span className="text-muted-foreground ml-1">✓ Recommended</span>
                      </span>
                      <span className="text-xs text-muted-foreground">Last 3 years ({dateRangeText})</span>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="custom" id="custom" />
                    <Label htmlFor="custom" className="cursor-pointer flex flex-col">
                      <span>Custom per channel (configure below)</span>
                      <span className="text-xs text-muted-foreground">Choose all or recent for each channel individually</span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="border rounded-lg">
                <button
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary/20 transition-colors"
                  onClick={() => setExpandDetails(!expandDetails)}
                  type="button"
                >
                  <span className="font-medium">
                    Channel-by-Channel Selection
                    {globalFilter === 'custom' && (
                      <span className="text-sm text-muted-foreground ml-2">
                        ({selectedCount} selected)
                      </span>
                    )}
                  </span>
                  {expandDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                
                {expandDetails && (
                  <div className="p-4 space-y-3 border-t">
                    {channelSettings.map((channel, index) => (
                      <div key={channel.channelId} className="flex items-center justify-between py-2 border-b last:border-0">
                        <div className="flex items-center space-x-3 flex-1">
                          <Checkbox
                            checked={channel.selected}
                            onCheckedChange={(checked) => {
                              setChannelSettings(prev => prev.map((ch, i) => 
                                i === index ? { ...ch, selected: checked as boolean } : ch
                              ));
                            }}
                          />
                          <div className="flex-1">
                            <div className="font-medium text-sm">{channel.channelName}</div>
                            <div className="text-xs text-muted-foreground">
                              <Play className="inline h-3 w-3 mr-1" />
                              {formatNumber(channel.totalVideos)} total
                              {channel.recentVideos !== null && (
                                <>
                                  {' • '}
                                  <Calendar className="inline h-3 w-3 mr-1" />
                                  {formatNumber(channel.recentVideos)} recent
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {globalFilter === 'custom' && channel.selected && (
                          <select
                            className="ml-4 px-3 py-1 text-sm border rounded"
                            value={channel.filterMode}
                            onChange={(e) => {
                              setChannelSettings(prev => prev.map((ch, i) => 
                                i === index ? { ...ch, filterMode: e.target.value as 'all' | 'recent' } : ch
                              ));
                            }}
                          >
                            <option value="all">All time ({formatNumber(channel.totalVideos)})</option>
                            <option value="recent">Last 3 years ({formatNumber(channel.recentVideos || 0)})</option>
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-primary/10 border-primary/20 border rounded-lg p-4">
                <h4 className="font-semibold mb-2">Summary</h4>
                <div className="space-y-1 text-sm">
                  <div>Channels selected: {selectedCount} of {channels.length}</div>
                  <div>Videos to import: {formatNumber(totalVideos)}</div>
                  <div>Estimated API calls: ~{apiCalls}</div>
                  <div className="text-xs text-muted-foreground pt-1">
                    Processing will continue in the background
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={loading || selectedCount === 0}
            className="bg-green-600 hover:bg-green-700"
          >
            <Upload className="h-4 w-4 mr-2" />
            Import Selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}