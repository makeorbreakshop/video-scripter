'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LineChart, Line, Area, AreaChart } from 'recharts';
import { Button } from '@/components/ui/button';

interface DataPoint {
  days: number;
  views: number;
  video_id: string;
  title: string;
}

// Function to extract duration in seconds from ISO 8601 format
function extractDurationSeconds(duration: string | null): number {
  if (!duration || duration === '' || duration === 'P0D') return 0;
  
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  
  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');
  
  return hours * 3600 + minutes * 60 + seconds;
}

// Function to check if video is a YouTube Short
function isYouTubeShort(duration: string | null, title?: string, description?: string): boolean {
  // Duration check: <= 121 seconds (2 minutes 1 second)
  const durationSeconds = extractDurationSeconds(duration);
  if (durationSeconds > 0 && durationSeconds <= 121) {
    return true;
  }
  
  // Hashtag check
  const combinedText = ((title || '') + ' ' + (description || '')).toLowerCase();
  if (combinedText.match(/#shorts?\b/) || combinedText.match(/#youtubeshorts?\b/)) {
    return true;
  }
  
  return false;
}

export default function AgeAdjustedDebugPage() {
  const [channels, setChannels] = useState<string[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>({});
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');

  // Load available channels
  useEffect(() => {
    async function loadChannels() {
      const { data } = await supabase
        .from('videos')
        .select('channel_name')
        .order('channel_name');
      
      const uniqueChannels = [...new Set(data?.map(v => v.channel_name) || [])];
      setChannels(uniqueChannels);
    }
    loadChannels();
  }, []);

  // Load all data points when channel selected
  useEffect(() => {
    if (!selectedChannel) return;

    async function loadAllDataPoints() {
      setLoading(true);
      
      // Get all videos with their snapshots for this channel
      const { data: videos } = await supabase
        .from('videos')
        .select(`
          id,
          title,
          published_at,
          duration,
          description,
          view_snapshots (
            days_since_published,
            view_count,
            snapshot_date
          )
        `)
        .eq('channel_name', selectedChannel)
        .order('published_at', { ascending: false });

      if (!videos) {
        setLoading(false);
        return;
      }

      // Extract all data points, filtering out shorts
      const allPoints: DataPoint[] = [];
      let totalVideos = 0;
      let videosWithSnapshots = 0;
      let totalSnapshots = 0;
      let shortsFiltered = 0;

      console.log('Processing videos:', videos.length);
      videos.forEach((v, i) => {
        // Skip YouTube Shorts
        if (isYouTubeShort(v.duration, v.title, v.description)) {
          shortsFiltered++;
          return;
        }
        
        totalVideos++;
        if (v.view_snapshots && v.view_snapshots.length > 0) {
          videosWithSnapshots++;
          totalSnapshots += v.view_snapshots.length;
          
          // Log first few videos to debug
          if (i < 3) {
            console.log(`Video ${i}: ${v.title}`, v.view_snapshots);
          }
          
          v.view_snapshots.forEach(s => {
            const point = {
              days: s.days_since_published,
              views: s.view_count,
              video_id: v.id,
              title: v.title
            };
            allPoints.push(point);
            
            // Log first few points
            if (allPoints.length <= 5) {
              console.log('Data point:', point);
            }
          });
        }
      });

      console.log('Total data points created:', allPoints.length);
      console.log('First 3 points:', allPoints.slice(0, 3));

      // Sort by days
      allPoints.sort((a, b) => a.days - b.days);

      setDataPoints(allPoints);
      setStats({
        totalVideos,
        videosWithSnapshots,
        totalSnapshots,
        totalDataPoints: allPoints.length,
        uniqueDays: new Set(allPoints.map(p => p.days)).size,
        shortsFiltered
      });
      setLoading(false);
    }

    loadAllDataPoints();
  }, [selectedChannel]);

  // Generate normalized comparison data for a specific video
  function generateNormalizedComparison(videoId: string) {
    if (!videoId || !dataPoints.length) return [];

    // Get this video's snapshots
    const videoSnapshots = dataPoints
      .filter(p => p.video_id === videoId)
      .sort((a, b) => a.days - b.days);

    if (videoSnapshots.length === 0) return [];

    // Calculate channel median performance for each day (0, 3, 4, 7, etc.)
    const dayGroups = new Map<number, number[]>();
    dataPoints.forEach(point => {
      if (!dayGroups.has(point.days)) {
        dayGroups.set(point.days, []);
      }
      dayGroups.get(point.days)!.push(point.views);
    });

    // Calculate median views for each day
    const channelMedians = new Map<number, number>();
    dayGroups.forEach((views, day) => {
      const sorted = views.sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      channelMedians.set(day, median);
    });

    // Find the earliest common day between video and channel data
    const videoStartDay = videoSnapshots[0].days;
    const channelDays = Array.from(channelMedians.keys()).sort((a, b) => a - b);
    const commonStartDay = channelDays.find(day => day >= videoStartDay) || videoStartDay;
    
    // Get baseline values from the earliest common day
    const videoBaseline = videoSnapshots.find(s => s.days === commonStartDay)?.views || videoSnapshots[0].views;
    const channelBaseline = channelMedians.get(commonStartDay) || channelMedians.get(videoStartDay) || videoBaseline;

    const normalizedData = [];

    // Only add actual data points where we have snapshots
    videoSnapshots.forEach(snapshot => {
      const channelMedian = channelMedians.get(snapshot.days);
      
      normalizedData.push({
        day: snapshot.days,
        videoPercent: (snapshot.views / videoBaseline) * 100,
        channelPercent: channelMedian ? (channelMedian / channelBaseline) * 100 : null,
        rawVideoViews: snapshot.views,
        rawChannelMedian: channelMedian || null
      });
    });

    // Add channel median points that don't have video snapshots
    channelMedians.forEach((median, day) => {
      if (!normalizedData.some(d => d.day === day) && day >= videoStartDay) {
        normalizedData.push({
          day,
          videoPercent: null,
          channelPercent: (median / channelBaseline) * 100,
          rawVideoViews: null,
          rawChannelMedian: median
        });
      }
    });

    return normalizedData.sort((a, b) => a.day - b.day);
  }

  const normalizedData = generateNormalizedComparison(selectedVideoId);
  const selectedVideoTitle = dataPoints.find(p => p.video_id === selectedVideoId)?.title;

  return (
    <div className="flex-1 space-y-6 p-8">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Age-Adjusted Debug View</h1>
          <p className="text-muted-foreground">
            Raw scatter plot of all video snapshots by days since publishing
          </p>
        </div>

        {/* Channel Selector */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium">Channel</label>
              <Select value={selectedChannel} onValueChange={setSelectedChannel}>
                <SelectTrigger className="w-[300px]">
                  <SelectValue placeholder="Select a channel to analyze..." />
                </SelectTrigger>
                <SelectContent>
                  {channels.map(channel => (
                    <SelectItem key={channel} value={channel}>
                      {channel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-center space-y-3">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
            <p className="text-muted-foreground">Loading all data points...</p>
          </div>
        </div>
      )}

      {!loading && dataPoints.length > 0 && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Videos</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalVideos}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Videos with Snapshots</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.videosWithSnapshots}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Snapshots</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalSnapshots}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Data Points</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalDataPoints}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Unique Days</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.uniqueDays}</div>
              </CardContent>
            </Card>
          </div>

          {/* Debug Info */}
          <Card>
            <CardHeader>
              <CardTitle>Debug Information</CardTitle>
              <CardDescription>Data validation and processing details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="text-center">
                  <div className="text-2xl font-bold">{selectedChannel}</div>
                  <div className="text-sm text-muted-foreground">Selected Channel</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{dataPoints.length}</div>
                  <div className="text-sm text-muted-foreground">Data Points</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{dataPoints.length > 0 ? '✅' : '❌'}</div>
                  <div className="text-sm text-muted-foreground">Has Data</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{dataPoints[0]?.days ?? 'N/A'}</div>
                  <div className="text-sm text-muted-foreground">First Point Day</div>
                </div>
              </div>

              {dataPoints.length > 0 && (
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Sample Data (First 5 Points)</h4>
                    <div className="space-y-2">
                      {dataPoints.slice(0, 5).map((point, i) => (
                        <div key={i} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                          <span className="font-mono">Day {point.days}</span>
                          <span>{point.views?.toLocaleString()} views</span>
                          <span className="text-muted-foreground truncate max-w-xs">{point.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Video Selector for Normalized Comparison */}
          <Card>
            <CardHeader>
              <CardTitle>Normalized Performance Comparison</CardTitle>
              <CardDescription>
                Compare individual video performance vs channel typical performance (like YouTube's backend)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-4">
                <label className="text-sm font-medium">Select Video</label>
                <Select value={selectedVideoId} onValueChange={setSelectedVideoId}>
                  <SelectTrigger className="w-[400px]">
                    <SelectValue placeholder="Choose a video to compare..." />
                  </SelectTrigger>
                  <SelectContent>
                    {/* Get unique videos from dataPoints */}
                    {Array.from(new Map(dataPoints.map(p => [p.video_id, p])).values())
                      .slice(0, 20) // Limit to first 20 for performance
                      .map(point => (
                        <SelectItem key={point.video_id} value={point.video_id}>
                          {point.title}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedVideoId && normalizedData.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                      <span>This video</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
                      <span>Typical performance</span>
                    </div>
                  </div>
                  
                  {/* Debug Info */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Debug Information</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-muted-foreground">Basic Stats</p>
                          <p>Total Videos: {dataPoints.filter(p => p.video_id).length / 3}</p>
                          <p>With Early Data: {Array.from(new Set(dataPoints.filter(p => p.days === 0).map(p => p.video_id))).length}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Sample Calculations</p>
                          {normalizedData.slice(0, 2).map((d, i) => (
                            <div key={i} className="text-xs">
                              <p>{selectedVideoTitle?.substring(0, 50)}...</p>
                              <p>D{d.day}: {d.videoPercent?.toFixed(0)}% ({d.rawVideoViews?.toLocaleString()} views)</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={normalizedData} margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="day"
                          label={{ value: 'Days Since Published', position: 'insideBottom', offset: -5 }}
                        />
                        <YAxis 
                          tickFormatter={(value) => `${value}%`}
                          label={{ value: 'Growth (% of Day 0)', angle: -90, position: 'insideLeft' }}
                          domain={[0, 'auto']}
                        />
                        <Tooltip 
                          formatter={(value: any, name: string) => {
                            if (!value) return 'N/A';
                            const label = name === 'videoPercent' ? 'This Video' : 'Typical Performance';
                            return [`${parseFloat(value).toFixed(1)}%`, label];
                          }}
                        />
                        {/* Individual video performance */}
                        <Line 
                          type="monotone" 
                          dataKey="videoPercent" 
                          stroke="#3b82f6" 
                          strokeWidth={3}
                          dot={{ fill: '#3b82f6', r: 5 }}
                          connectNulls={false}
                        />
                        {/* Channel median performance */}
                        <Line 
                          type="monotone" 
                          dataKey="channelPercent" 
                          stroke="#9ca3af" 
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="text-sm text-muted-foreground">
                    <p><strong>Selected:</strong> {selectedVideoTitle}</p>
                    <p>Growth shown as percentage of Day 0 views (100% = same as Day 0). Typical performance is the median across all videos.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Video Growth Trajectories */}
          <Card>
            <CardHeader>
              <CardTitle>Video Growth Trajectories</CardTitle>
              <CardDescription>
                Raw view data with lines connecting snapshots from the same video - {dataPoints.length} data points
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  {(() => {
                    // Group data points by video_id and create datasets for each video
                    const videoGroups = new Map<string, Array<{days: number; views: number; title: string}>>();
                    
                    dataPoints.forEach(point => {
                      if (!videoGroups.has(point.video_id)) {
                        videoGroups.set(point.video_id, []);
                      }
                      videoGroups.get(point.video_id)!.push({
                        days: point.days,
                        views: point.views,
                        title: point.title
                      });
                    });
                    
                    // Sort each video's snapshots by days
                    videoGroups.forEach(snapshots => {
                      snapshots.sort((a, b) => a.days - b.days);
                    });
                    
                    // Create a unified data structure that works with LineChart  
                    const allDays = [...new Set(dataPoints.map(p => p.days))].sort((a, b) => a - b);
                    const chartData = allDays.map(day => {
                      const dayData: any = { day };
                      
                      videoGroups.forEach((snapshots, videoId) => {
                        const snapshot = snapshots.find(s => s.days === day);
                        if (snapshot) {
                          dayData[`video_${videoId}`] = snapshot.views;
                          dayData[`title_${videoId}`] = snapshot.title;
                        }
                      });
                      
                      return dayData;
                    });
                    
                    const videoIds = Array.from(videoGroups.keys()); // Show all videos
                    
                    return (
                      <LineChart data={chartData} margin={{ top: 20, right: 20, bottom: 60, left: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis 
                          dataKey="day"
                          label={{ value: 'Days Since Published', position: 'insideBottom', offset: -5 }}
                          domain={['dataMin', 'dataMax']}
                        />
                        <YAxis 
                          tickFormatter={(value) => {
                            if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                            if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
                            return value;
                          }}
                          label={{ value: 'Total Views', angle: -90, position: 'insideLeft' }}
                        />
                        <Tooltip 
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length > 0) {
                              const validPayload = payload.filter(p => p.value && p.dataKey?.toString().startsWith('video_'));
                              if (validPayload.length === 0) return null;
                              
                              return (
                                <div className="bg-background border rounded p-2 shadow-lg max-w-xs">
                                  <p className="text-xs text-muted-foreground mb-1">Day {label}</p>
                                  {validPayload.slice(0, 3).map((entry, index) => {
                                    const videoId = entry.dataKey?.toString().replace('video_', '');
                                    const title = entry.payload[`title_${videoId}`];
                                    return (
                                      <div key={index} className="mb-1">
                                        <p className="font-medium text-xs truncate">{title}</p>
                                        <p className="text-xs">{parseInt(entry.value as string).toLocaleString()} views</p>
                                      </div>
                                    );
                                  })}
                                  {validPayload.length > 3 && (
                                    <p className="text-xs text-muted-foreground">...and {validPayload.length - 3} more</p>
                                  )}
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        
                        {videoIds.map((videoId, index) => (
                          <Line
                            key={videoId}
                            type="monotone"
                            dataKey={`video_${videoId}`}
                            stroke={`hsl(${(index * 137.5) % 360}, 70%, 50%)`}
                            strokeWidth={1.5}
                            dot={{ r: 2, fill: `hsl(${(index * 137.5) % 360}, 70%, 50%)` }}
                            connectNulls={false}
                          />
                        ))}
                      </LineChart>
                    );
                  })()}
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>


          {/* Data Table Sample */}
          <Card>
            <CardHeader>
              <CardTitle>Sample Data Points (First 20)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {dataPoints.slice(0, 20).map((point, i) => (
                  <div key={i} className="flex items-center justify-between py-1 border-b last:border-0 text-sm">
                    <div className="flex-1">
                      <p className="font-medium truncate">{point.title}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-muted-foreground">Day {point.days}:</span>
                      <span className="ml-2 font-medium">{point.views.toLocaleString()} views</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}