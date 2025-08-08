'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingUp, BarChart3, RefreshCw, Search, Video } from 'lucide-react';

interface BaselineResult {
  channel_id: string;
  channel_name: string;
  method: string;
  num_synthetic_videos: number;
  avg_multiplier: number;
  median_multiplier: number;
  std_multiplier: number;
  min_multiplier: number;
  max_multiplier: number;
  predictions: Array<{
    video_index: number;
    performance_multiplier: number;
    synthetic: boolean;
  }>;
  channel_characteristics: {
    subscriber_count: number;
    channel_tier: string;
    dominant_format: string;
    dominant_topic: number;
    avg_title_length: number;
  };
}

interface VideoResult {
  id: string;
  title: string;
  channel_id: string;
  channel_name: string;
  published_at: string;
  format_type: string;
  topic_cluster_id: number;
  topic_domain: string;
  subscriber_count: number | null;
  title_word_count: number;
}

const formatTypes = [
  'tutorial', 'case_study', 'explainer', 'listicle', 'personal_story', 
  'product_focus', 'vlog', 'news_analysis', 'compilation', 'shorts'
];

export default function BaselineTestPage() {
  const [channelData, setChannelData] = useState({
    channel_id: '',
    channel_name: '',
    subscriber_count: 100000,
    dominant_format: 'tutorial',
    dominant_topic_cluster: 50,
    avg_title_length: 8
  });
  
  const [baseline, setBaseline] = useState<BaselineResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Video search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VideoResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null);

  const handleInputChange = (field: string, value: string | number) => {
    setChannelData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const searchVideos = async () => {
    if (!searchQuery.trim()) {
      // Load recent videos if no search query
      setSearchQuery('');
    }
    
    setSearchLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/videos/search?q=${encodeURIComponent(searchQuery)}&limit=20`);
      const result = await response.json();
      
      if (result.success) {
        setSearchResults(result.videos);
      } else {
        setError(result.error || 'Failed to search videos');
        setSearchResults([]);
      }
    } catch (err) {
      setError('Failed to search videos');
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const selectVideo = async (video: VideoResult) => {
    setSelectedVideo(video);
    setError(null);
    
    try {
      // Get channel characteristics for this video's channel
      const response = await fetch('/api/videos/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_id: video.channel_id })
      });
      
      const result = await response.json();
      
      if (result.success) {
        const channelStats = result.channel_data;
        
        // Auto-fill channel data based on the selected video and channel stats
        setChannelData({
          channel_id: video.channel_id,
          channel_name: video.channel_name,
          subscriber_count: channelStats.subscriber_count || video.subscriber_count || 100000,
          dominant_format: channelStats.dominant_format || video.format_type,
          dominant_topic_cluster: channelStats.dominant_topic_cluster || video.topic_cluster_id,
          avg_title_length: channelStats.avg_title_length || video.title_word_count
        });
        
        // Clear previous baseline when selecting new video
        setBaseline(null);
      } else {
        // Fallback to video data if channel stats fail
        setChannelData({
          channel_id: video.channel_id,
          channel_name: video.channel_name,
          subscriber_count: video.subscriber_count || 100000,
          dominant_format: video.format_type,
          dominant_topic_cluster: video.topic_cluster_id,
          avg_title_length: video.title_word_count
        });
      }
    } catch (err) {
      setError('Failed to load channel data');
    }
  };

  const loadExampleChannel = (example: 'tech' | 'woodworking' | 'finance' | 'marketing') => {
    const examples = {
      tech: {
        channel_id: 'UCBJycsmduvYEL83R_U4JriQ',
        channel_name: 'Marques Brownlee',
        subscriber_count: 20100000,
        dominant_format: 'product_focus',
        dominant_topic_cluster: 393,
        avg_title_length: 6
      },
      woodworking: {
        channel_id: 'UCstwpLSByklww1YojZN-KiQ',
        channel_name: 'Stumpy Nubs (James Hamilton)',
        subscriber_count: 1000000,
        dominant_format: 'tutorial',
        dominant_topic_cluster: 1,
        avg_title_length: 10
      },
      finance: {
        channel_id: 'UC7ZddA__ewP3AtDefjl_tWg',
        channel_name: 'I Will Teach You To Be Rich',
        subscriber_count: 940000,
        dominant_format: 'explainer',
        dominant_topic_cluster: 37,
        avg_title_length: 9
      },
      marketing: {
        channel_id: 'UCLZ6-13n1-IzVGCSNYP_CSw',
        channel_name: 'Niche Pursuits',
        subscriber_count: 91100,
        dominant_format: 'case_study',
        dominant_topic_cluster: 42,
        avg_title_length: 13
      }
    };
    
    setChannelData(examples[example]);
    setBaseline(null);
    setError(null);
  };

  const generateBaseline = async () => {
    if (!channelData.channel_name) {
      setError('Please enter a channel name');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/ml/recent-baseline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: channelData,
          num_videos: 10
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to generate baseline');
      }
      
      setBaseline(result.baselines[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate baseline');
    } finally {
      setLoading(false);
    }
  };

  const getChannelTierColor = (tier: string) => {
    const colors = {
      'micro': 'bg-gray-500',
      'small': 'bg-blue-500',
      'medium': 'bg-green-500',
      'large': 'bg-yellow-500',
      'mega': 'bg-purple-500'
    };
    return colors[tier as keyof typeof colors] || 'bg-gray-500';
  };

  const getChannelTierLabel = (tier: string) => {
    const labels = {
      'micro': 'Micro (<1K)',
      'small': 'Small (1K-10K)',
      'medium': 'Medium (10K-100K)',
      'large': 'Large (100K-1M)',
      'mega': 'Mega (1M+)'
    };
    return labels[tier as keyof typeof labels] || tier;
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">ML Recent Baseline Generator</h1>
        <p className="text-gray-600">
          Generate ML-based recent performance baselines for channels with sparse data
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Input Form */}
        <Card className="xl:col-span-1">
          <CardHeader>
            <CardTitle>Channel Details</CardTitle>
            <CardDescription>
              Search for real videos to auto-fill channel data
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Video Search */}
            <div>
              <Label className="text-sm font-medium">Search Real Videos</Label>
              <div className="flex gap-2 mt-2">
                <Input
                  placeholder="Search videos or channels..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && searchVideos()}
                />
                <Button 
                  onClick={searchVideos} 
                  disabled={searchLoading}
                  size="sm"
                >
                  {searchLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
              
              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="mt-3 max-h-40 overflow-y-auto space-y-1">
                  {searchResults.slice(0, 10).map((video) => (
                    <div
                      key={video.id}
                      className="p-2 text-xs border rounded cursor-pointer hover:bg-gray-50"
                      onClick={() => selectVideo(video)}
                    >
                      <div className="font-medium truncate">{video.title}</div>
                      <div className="text-gray-500 flex items-center gap-2">
                        <span>{video.channel_name}</span>
                        <span>•</span>
                        <span>{video.format_type}</span>
                        {video.subscriber_count && (
                          <>
                            <span>•</span>
                            <span>{(video.subscriber_count / 1000).toFixed(0)}K subs</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Example Channels */}
            <div>
              <Label className="text-sm font-medium">Or Use Examples</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Button variant="outline" size="sm" onClick={() => loadExampleChannel('tech')}>
                  Tech (MKBHD)
                </Button>
                <Button variant="outline" size="sm" onClick={() => loadExampleChannel('woodworking')}>
                  Woodworking
                </Button>
                <Button variant="outline" size="sm" onClick={() => loadExampleChannel('finance')}>
                  Finance
                </Button>
                <Button variant="outline" size="sm" onClick={() => loadExampleChannel('marketing')}>
                  Marketing
                </Button>
              </div>
            </div>

            {/* Selected Video Indicator */}
            {selectedVideo && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Video className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-medium text-blue-800">Selected Video</span>
                </div>
                <div className="text-xs text-blue-700">
                  <div className="font-medium truncate">{selectedVideo.title}</div>
                  <div className="text-blue-600">{selectedVideo.channel_name}</div>
                </div>
              </div>
            )}

            {/* Channel Name */}
            <div>
              <Label htmlFor="channel_name">Channel Name *</Label>
              <Input
                id="channel_name"
                value={channelData.channel_name}
                onChange={(e) => handleInputChange('channel_name', e.target.value)}
                placeholder={selectedVideo ? "Auto-filled from selected video" : "Enter channel name..."}
                className="mt-1"
              />
            </div>

            {/* Subscriber Count */}
            <div>
              <Label htmlFor="subscriber_count">Subscriber Count</Label>
              <Input
                id="subscriber_count"
                type="number"
                value={channelData.subscriber_count}
                onChange={(e) => handleInputChange('subscriber_count', parseInt(e.target.value) || 0)}
                placeholder="100000"
                className="mt-1"
              />
            </div>

            {/* Dominant Format */}
            <div>
              <Label htmlFor="format">Dominant Content Format</Label>
              <Select 
                value={channelData.dominant_format} 
                onValueChange={(value) => handleInputChange('dominant_format', value)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  {formatTypes.map(format => (
                    <SelectItem key={format} value={format}>
                      {format.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Topic Cluster */}
            <div>
              <Label htmlFor="topic">Dominant Topic Cluster</Label>
              <Input
                id="topic"
                type="number"
                value={channelData.dominant_topic_cluster}
                onChange={(e) => handleInputChange('dominant_topic_cluster', parseInt(e.target.value) || 0)}
                placeholder="0-216"
                className="mt-1"
              />
            </div>

            {/* Average Title Length */}
            <div>
              <Label htmlFor="title_length">Average Title Length (words)</Label>
              <Input
                id="title_length"
                type="number"
                value={channelData.avg_title_length}
                onChange={(e) => handleInputChange('avg_title_length', parseInt(e.target.value) || 0)}
                placeholder="8"
                className="mt-1"
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="text-red-600 text-sm p-2 bg-red-50 rounded">
                {error}
              </div>
            )}

            {/* Generate Button */}
            <Button 
              onClick={generateBaseline} 
              disabled={loading || !channelData.channel_name}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Generate ML Baseline
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Results Display */}
        <div className="xl:col-span-2 space-y-6">
          {!baseline ? (
            <Card>
              <CardContent className="py-12">
                <div className="text-center text-gray-500">
                  <BarChart3 className="mx-auto h-16 w-16 mb-4 opacity-30" />
                  <p>Enter channel details and click "Generate ML Baseline" to see results</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Baseline Summary */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{baseline.channel_name}</CardTitle>
                      <CardDescription>ML-Generated Recent Baseline</CardDescription>
                    </div>
                    <Badge 
                      className={`${getChannelTierColor(baseline.channel_characteristics.channel_tier)} text-white`}
                    >
                      {getChannelTierLabel(baseline.channel_characteristics.channel_tier)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {baseline.avg_multiplier.toFixed(2)}x
                      </div>
                      <div className="text-sm text-gray-600">Average Multiplier</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {baseline.median_multiplier.toFixed(2)}x
                      </div>
                      <div className="text-sm text-gray-600">Median Multiplier</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-gray-600">
                        {baseline.min_multiplier.toFixed(2)}x - {baseline.max_multiplier.toFixed(2)}x
                      </div>
                      <div className="text-sm text-gray-600">Range</div>
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-bold text-purple-600">
                        {baseline.std_multiplier.toFixed(2)}
                      </div>
                      <div className="text-sm text-gray-600">Std Dev</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Performance Distribution Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>ML-Generated Performance Distribution</CardTitle>
                  <CardDescription>
                    Simulated performance for {baseline.num_synthetic_videos} recent videos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Simple bar chart visualization */}
                    <div className="grid grid-cols-10 gap-1 h-32">
                      {baseline.predictions.map((pred, index) => (
                        <div key={index} className="flex flex-col justify-end">
                          <div 
                            className="bg-blue-500 rounded-t min-h-[4px]"
                            style={{
                              height: `${(pred.performance_multiplier / baseline.max_multiplier) * 100}%`
                            }}
                          />
                          <div className="text-xs text-center mt-1 text-gray-600">
                            {(pred.performance_multiplier).toFixed(1)}x
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* Legend */}
                    <div className="flex justify-center">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <div className="w-3 h-3 bg-blue-500 rounded"></div>
                        <span>Synthetic Recent Videos (ML Generated)</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Channel Characteristics */}
              <Card>
                <CardHeader>
                  <CardTitle>Channel Characteristics Used</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="font-medium">Subscribers</div>
                      <div className="text-gray-600">{baseline.channel_characteristics.subscriber_count.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="font-medium">Channel Tier</div>
                      <div className="text-gray-600">{baseline.channel_characteristics.channel_tier}</div>
                    </div>
                    <div>
                      <div className="font-medium">Dominant Format</div>
                      <div className="text-gray-600">{baseline.channel_characteristics.dominant_format}</div>
                    </div>
                    <div>
                      <div className="font-medium">Topic Cluster</div>
                      <div className="text-gray-600">{baseline.channel_characteristics.dominant_topic}</div>
                    </div>
                    <div>
                      <div className="font-medium">Avg Title Length</div>
                      <div className="text-gray-600">{baseline.channel_characteristics.avg_title_length} words</div>
                    </div>
                    <div>
                      <div className="font-medium">Method</div>
                      <div className="text-gray-600">ML Backfill</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* How it works */}
      <Card className="mt-6">
        <CardContent className="pt-6">
          <h3 className="font-medium mb-2">How ML Baseline Backfill Works</h3>
          <p className="text-sm text-gray-600 mb-4">
            For channels with sparse recent data, this system uses machine learning to generate synthetic 
            "recent" video performance based on channel characteristics. This provides time-relevant baselines 
            for calculating performance ratios, rather than relying on outdated historical data.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="p-3 bg-gray-50 rounded">
              <div className="font-medium text-blue-600 mb-1">1. Channel Analysis</div>
              <div className="text-gray-600">Extract channel tier, dominant format, topic focus, and content patterns</div>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <div className="font-medium text-green-600 mb-1">2. ML Prediction</div>
              <div className="text-gray-600">Generate 10 synthetic recent videos using the trained XGBoost model</div>
            </div>
            <div className="p-3 bg-gray-50 rounded">
              <div className="font-medium text-purple-600 mb-1">3. Baseline Calculation</div>
              <div className="text-gray-600">Calculate recent baseline statistics for more accurate performance ratios</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}