'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Loader2, 
  TrendingUp, 
  ExternalLink,
  AlertCircle,
  Zap,
  Trophy,
  Target,
  Calendar,
  Search,
  Filter,
  ArrowUpDown
} from 'lucide-react';

interface Video {
  video_id: string;
  title: string;
  channel_name: string;
  channel_id: string;
  channel_size: string;
  subscriber_count?: number;
  view_count: number;
  published_at: string;
  thumbnail_url?: string;
  performance_ratio: number;
  channel_avg_views: number;
  similarity_score: number;
  search_query: string;
  outlier_strength?: 'strong' | 'exceptional' | 'breakthrough';
  is_outlier: boolean;
}

export default function VideoExplorerPage() {
  const [concept, setConcept] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [summary, setSummary] = useState<any>(null);
  
  // Filters and sorting
  const [performanceFilter, setPerformanceFilter] = useState<number>(1.0);
  const [showOnlyOutliers, setShowOnlyOutliers] = useState(false);
  const [selectedQuery, setSelectedQuery] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('performance');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!concept.trim()) return;

    setLoading(true);
    setError(null);
    setVideos([]);
    setSummary(null);
    
    // Reset filters
    setPerformanceFilter(1.0);
    setShowOnlyOutliers(false);
    setSelectedQuery('all');

    try {
      const response = await fetch('/api/youtube/outliers/find', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          concept: concept.trim(),
          options: {
            limit: 200,
            includeAdjacent: true,
            showSearchSource: true
          }
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to find videos');
      }

      setVideos(data.videos || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort videos
  const filteredAndSortedVideos = useMemo(() => {
    let filtered = [...videos];
    
    // Apply performance filter
    filtered = filtered.filter(v => v.performance_ratio >= performanceFilter);
    
    // Apply outlier filter
    if (showOnlyOutliers) {
      filtered = filtered.filter(v => v.is_outlier);
    }
    
    // Apply search query filter
    if (selectedQuery !== 'all') {
      filtered = filtered.filter(v => v.search_query === selectedQuery);
    }
    
    // Sort videos
    switch (sortBy) {
      case 'performance':
        filtered.sort((a, b) => b.performance_ratio - a.performance_ratio);
        break;
      case 'views':
        filtered.sort((a, b) => b.view_count - a.view_count);
        break;
      case 'recent':
        filtered.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
        break;
      case 'similarity':
        filtered.sort((a, b) => b.similarity_score - a.similarity_score);
        break;
    }
    
    return filtered;
  }, [videos, performanceFilter, showOnlyOutliers, selectedQuery, sortBy]);

  const getOutlierColor = (strength?: string) => {
    if (!strength) return '';
    switch (strength) {
      case 'breakthrough': return 'bg-purple-500';
      case 'exceptional': return 'bg-green-500';
      case 'strong': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  const getOutlierIcon = (strength?: string) => {
    if (!strength) return null;
    switch (strength) {
      case 'breakthrough': return <Zap className="w-4 h-4" />;
      case 'exceptional': return <Trophy className="w-4 h-4" />;
      case 'strong': return <Target className="w-4 h-4" />;
      default: return <TrendingUp className="w-4 h-4" />;
    }
  };

  const formatViewCount = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  };

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Video Explorer</h1>
        <p className="text-muted-foreground">
          Search for videos by topic and explore performance patterns
        </p>
      </div>

      {/* Search Form */}
      <Card>
        <CardHeader>
          <CardTitle>Search Videos</CardTitle>
          <CardDescription>
            Enter a topic to find related videos with semantic expansion
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="concept">Topic or Concept</Label>
              <div className="flex gap-2">
                <Input
                  id="concept"
                  placeholder="e.g., how to build a table, React tutorial, meal prep"
                  value={concept}
                  onChange={(e) => setConcept(e.target.value)}
                  disabled={loading}
                  className="flex-1"
                />
                <Button type="submit" disabled={loading || !concept.trim()}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Searching...
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Search
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Summary Stats */}
      {summary && (
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Found</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.total_videos_found}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Outliers (3x+)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.outliers_found}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Top Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.top_performance_ratio.toFixed(1)}x</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.average_performance_ratio.toFixed(1)}x</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Search Queries</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{Object.keys(summary.search_query_distribution || {}).length}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters and Controls */}
      {videos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              Filters & Sorting
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              {/* Performance Filter */}
              <div className="space-y-2">
                <Label>Min Performance: {performanceFilter.toFixed(1)}x</Label>
                <Slider
                  value={[performanceFilter]}
                  onValueChange={(value) => setPerformanceFilter(value[0])}
                  min={1}
                  max={10}
                  step={0.5}
                  className="mt-2"
                />
              </div>

              {/* Search Query Filter */}
              <div className="space-y-2">
                <Label>Search Query</Label>
                <Select value={selectedQuery} onValueChange={setSelectedQuery}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Queries</SelectItem>
                    {summary && Object.entries(summary.search_query_distribution || {}).map(([query, count]) => (
                      <SelectItem key={query} value={query}>
                        {query} ({count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Sort By */}
              <div className="space-y-2">
                <Label>Sort By</Label>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="performance">Performance Ratio</SelectItem>
                    <SelectItem value="views">View Count</SelectItem>
                    <SelectItem value="recent">Most Recent</SelectItem>
                    <SelectItem value="similarity">Relevance</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Outliers Only */}
              <div className="flex items-end">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="outliers-only"
                    checked={showOnlyOutliers}
                    onCheckedChange={(checked) => setShowOnlyOutliers(!!checked)}
                  />
                  <Label htmlFor="outliers-only" className="cursor-pointer">
                    Outliers Only (3x+)
                  </Label>
                </div>
              </div>
            </div>

            {/* Results Count */}
            <div className="text-sm text-muted-foreground">
              Showing {filteredAndSortedVideos.length} of {videos.length} videos
            </div>
          </CardContent>
        </Card>
      )}

      {/* Video Results */}
      {filteredAndSortedVideos.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Videos</h2>

          {filteredAndSortedVideos.map((video) => (
            <Card key={video.video_id}>
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  {/* Thumbnail */}
                  {video.thumbnail_url && (
                    <img 
                      src={video.thumbnail_url} 
                      alt={video.title}
                      className="w-40 h-24 object-cover rounded-lg flex-shrink-0"
                    />
                  )}
                  
                  {/* Content */}
                  <div className="flex-1 space-y-3">
                    {/* Title and Performance */}
                    <div>
                      <h3 className="font-semibold text-lg leading-tight">
                        {video.title}
                      </h3>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {video.outlier_strength && (
                          <Badge className={`${getOutlierColor(video.outlier_strength)} text-white`}>
                            {getOutlierIcon(video.outlier_strength)}
                            <span className="ml-1">{video.performance_ratio.toFixed(1)}x average</span>
                          </Badge>
                        )}
                        {!video.outlier_strength && (
                          <Badge variant="secondary">
                            {video.performance_ratio.toFixed(1)}x average
                          </Badge>
                        )}
                        <Badge variant="secondary">
                          {formatViewCount(video.view_count)} views
                        </Badge>
                        <Badge variant="outline">
                          {(video.similarity_score * 100).toFixed(0)}% match
                        </Badge>
                        {video.search_query !== concept && (
                          <Badge variant="outline" className="text-xs">
                            via: {video.search_query}
                          </Badge>
                        )}
                        {(() => {
                          const daysSincePublish = Math.floor((Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24));
                          if (daysSincePublish <= 30) {
                            return <Badge variant="default" className="bg-green-500">Last 30 days</Badge>;
                          } else if (daysSincePublish <= 90) {
                            return <Badge variant="default" className="bg-blue-500">Last 90 days</Badge>;
                          }
                          return null;
                        })()}
                      </div>
                    </div>

                    {/* Channel Info */}
                    <div className="text-sm text-muted-foreground">
                      <p>
                        <span className="font-medium">{video.channel_name}</span>
                        {' • '}
                        Average: {formatViewCount(Math.round(video.channel_avg_views))} views
                        {' • '}
                        Published: {new Date(video.published_at).toLocaleDateString('en-US', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </p>
                    </div>

                    {/* Performance Context */}
                    <div className="text-sm">
                      <p className="text-muted-foreground">
                        This video got <span className="font-semibold text-foreground">
                          {formatViewCount(video.view_count)}
                        </span> views compared to the channel's average of <span className="font-semibold text-foreground">
                          {formatViewCount(Math.round(video.channel_avg_views))}
                        </span> views.
                        {video.outlier_strength === 'breakthrough' && (
                          <span className="text-purple-600 font-semibold"> Massive breakthrough performance!</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Watch Link */}
                  <a
                    href={`https://youtube.com/watch?v=${video.video_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0"
                  >
                    <Button variant="ghost" size="icon">
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}