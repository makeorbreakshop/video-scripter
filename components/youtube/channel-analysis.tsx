'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown,
  Calendar,
  Eye,
  TrendingUp,
  Video,
  Clock
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

interface Video {
  id: string;
  title: string;
  view_count: number;
  published_at: string;
  thumbnail_url: string;
  channel_id: string;
  channel_name: string;
  temporal_performance_score: number | null;
  channel_baseline_at_publish?: number;
  rolling_baseline_views?: number;
}

interface ChannelOverview {
  channel_name: string;
  channel_id: string;
  total_videos: number;
  total_views: number;
  avg_views: number;
  avg_temporal_performance_score: number | null;
  uploads_per_month: number;
  date_range: {
    oldest: string;
    newest: string;
  };
  performance_distribution: {
    under_half: number;
    half_to_one: number;
    one_to_two: number;
    over_two: number;
  };
  top_performers: Video[];
  bottom_performers: Video[];
}

interface ChannelData {
  channel_overview: ChannelOverview;
  videos: Video[];
}

interface ChannelAnalysisProps {
  channelId: string;
}

type SortField = 'title' | 'view_count' | 'published_at' | 'temporal_performance_score';
type SortDirection = 'asc' | 'desc';

export function ChannelAnalysis({ channelId }: ChannelAnalysisProps) {
  const [data, setData] = useState<ChannelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState('90d'); // Default to 90 days
  
  // Table state
  const [sortField, setSortField] = useState<SortField>('temporal_performance_score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchTerm, setSearchTerm] = useState('');
  
  const router = useRouter();

  useEffect(() => {
    async function fetchChannelData() {
      try {
        setLoading(true);
        const response = await fetch(`/api/youtube/channels/${encodeURIComponent(channelId)}?dateFilter=${dateFilter}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch channel data');
        }
        
        const channelData = await response.json();
        setData(channelData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }

    fetchChannelData();
  }, [channelId, dateFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-4 h-4" />;
    return sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />;
  };

  const formatNumber = (num: number | null | undefined) => {
    if (num == null || isNaN(num)) return '0';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toLocaleString();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getPerformanceBadgeVariant = (ratio: number | null) => {
    if (!ratio) return 'secondary';
    if (ratio >= 2.0) return 'default'; // green
    if (ratio >= 1.0) return 'secondary'; // gray
    return 'destructive'; // red
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">Error: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { channel_overview, videos } = data;

  // Filter and sort videos
  const filteredVideos = videos.filter(video =>
    video.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedVideos = [...filteredVideos].sort((a, b) => {
    let aValue: any = a[sortField];
    let bValue: any = b[sortField];
    
    if (sortField === 'published_at') {
      aValue = new Date(aValue).getTime();
      bValue = new Date(bValue).getTime();
    }
    
    if (aValue === null) aValue = -1;
    if (bValue === null) bValue = -1;
    
    if (sortDirection === 'asc') {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  return (
    <div className="space-y-6">
      {/* Channel Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="w-5 h-5" />
            {channel_overview.channel_name}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{channel_overview.total_videos}</div>
              <div className="text-sm text-muted-foreground">Total Videos</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{formatNumber(channel_overview.avg_views)}</div>
              <div className="text-sm text-muted-foreground">Avg Views</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">
                {channel_overview.avg_temporal_performance_score ? `${channel_overview.avg_temporal_performance_score.toFixed(2)}x` : 'N/A'}
              </div>
              <div className="text-sm text-muted-foreground">Avg Performance</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold">{channel_overview.uploads_per_month}</div>
              <div className="text-sm text-muted-foreground">Videos/Month</div>
            </div>
          </div>
        </CardContent>
      </Card>


      {/* Top Performers */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Top Performers</CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={dateFilter === '30d' ? 'default' : 'outline'}
                onClick={() => setDateFilter('30d')}
              >
                30 days
              </Button>
              <Button
                size="sm"
                variant={dateFilter === '90d' ? 'default' : 'outline'}
                onClick={() => setDateFilter('90d')}
              >
                90 days
              </Button>
              <Button
                size="sm"
                variant={dateFilter === '180d' ? 'default' : 'outline'}
                onClick={() => setDateFilter('180d')}
              >
                6 months
              </Button>
              <Button
                size="sm"
                variant={dateFilter === '365d' ? 'default' : 'outline'}
                onClick={() => setDateFilter('365d')}
              >
                1 year
              </Button>
              <Button
                size="sm"
                variant={dateFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setDateFilter('all')}
              >
                All time
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {channel_overview.top_performers.map((video) => (
              <div 
                key={video.id} 
                className="border rounded-lg overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => router.push(`/videos/${video.id}`)}
              >
                <div className="relative aspect-video">
                  <Image
                    src={video.thumbnail_url}
                    alt={video.title}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="p-3">
                  <h4 className="font-medium text-sm line-clamp-2 mb-2">{video.title}</h4>
                  <div className="flex justify-between items-center text-xs text-muted-foreground">
                    <span>{formatNumber(video.view_count)} views</span>
                    <Badge variant={getPerformanceBadgeVariant(video.temporal_performance_score)}>
                      {video.temporal_performance_score ? `${video.temporal_performance_score.toFixed(2)}x` : 'N/A'}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* All Videos Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5" />
            All Videos ({videos.length})
          </CardTitle>
          <div className="flex gap-2">
            <Input
              placeholder="Search videos..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Thumbnail</TableHead>
                  <TableHead>
                    <Button variant="ghost" onClick={() => handleSort('title')}>
                      Title {getSortIcon('title')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" onClick={() => handleSort('view_count')}>
                      Views {getSortIcon('view_count')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" onClick={() => handleSort('temporal_performance_score')}>
                      Performance {getSortIcon('temporal_performance_score')}
                    </Button>
                  </TableHead>
                  <TableHead>
                    <Button variant="ghost" onClick={() => handleSort('published_at')}>
                      Published {getSortIcon('published_at')}
                    </Button>
                  </TableHead>
                  <TableHead>Channel Avg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedVideos.map((video) => (
                  <TableRow key={video.id}>
                    <TableCell>
                      <div 
                        className="relative w-16 h-9 cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/videos/${video.id}`);
                        }}
                      >
                        <Image
                          src={video.thumbnail_url}
                          alt={video.title}
                          fill
                          className="object-cover rounded"
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-md">
                        <p className="font-medium line-clamp-2">{video.title}</p>
                      </div>
                    </TableCell>
                    <TableCell>{formatNumber(video.view_count)}</TableCell>
                    <TableCell>
                      <Badge variant={getPerformanceBadgeVariant(video.temporal_performance_score)}>
                        {video.temporal_performance_score ? `${video.temporal_performance_score.toFixed(2)}x` : 'N/A'}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(video.published_at)}</TableCell>
                    <TableCell>
                      {video.rolling_baseline_views ? formatNumber(video.rolling_baseline_views) : 'N/A'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}