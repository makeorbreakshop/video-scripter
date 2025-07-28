'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Users, 
  Play, 
  CheckCircle, 
  Clock, 
  X, 
  ExternalLink,
  RefreshCw
} from 'lucide-react';

interface DiscoveredChannel {
  discovered_channel_id: string;
  channel_title: string;
  subscriber_count: number;
  video_count: number;
  validation_status: 'pending' | 'approved' | 'rejected';
  discovered_at: string;
  discovery_count: number;
  relevance_score: number;
}

export function DiscoveryReviewQueue() {
  const [channels, setChannels] = useState<DiscoveredChannel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadChannels();
  }, []);

  const loadChannels = async () => {
    try {
      const response = await fetch('/api/youtube/discovery/review-queue');
      if (response.ok) {
        const data = await response.json();
        setChannels(data.channels || []);
      }
    } catch (error) {
      console.error('Error loading channels:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateChannelStatus = async (channelId: string, action: 'approve' | 'reject') => {
    try {
      const response = await fetch('/api/youtube/discovery/review-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId,
          action
        })
      });

      if (response.ok) {
        loadChannels();
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
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-8 w-8 animate-spin" />
            <span className="ml-2">Loading review queue...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Channels Pending Review</CardTitle>
        <CardDescription>
          Review discovered channels and approve them for import ({channels.length} pending)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {channels.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No channels pending review. Run discovery to find new channels.
          </div>
        ) : (
          <div className="space-y-4">
            {channels.map((channel) => (
              <div
                key={channel.discovered_channel_id}
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold">{channel.channel_title}</h3>
                    <Badge variant={
                      channel.validation_status === 'pending' ? 'secondary' :
                      channel.validation_status === 'approved' ? 'default' : 'destructive'
                    }>
                      {channel.validation_status}
                    </Badge>
                    {channel.discovery_count > 1 && (
                      <Badge variant="outline" className="text-xs">
                        Found {channel.discovery_count}x
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Users className="h-4 w-4" />
                      {formatNumber(channel.subscriber_count)} subscribers
                    </div>
                    <div className="flex items-center gap-1">
                      <Play className="h-4 w-4" />
                      {formatNumber(channel.video_count)} videos
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {new Date(channel.discovered_at).toLocaleDateString()}
                    </div>
                    {channel.relevance_score > 0 && (
                      <div className="text-xs">
                        Score: {channel.relevance_score.toFixed(1)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`https://youtube.com/channel/${channel.discovered_channel_id}`, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>

                  {channel.validation_status === 'pending' && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateChannelStatus(channel.discovered_channel_id, 'approve')}
                        className="text-green-600 hover:text-green-700"
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateChannelStatus(channel.discovered_channel_id, 'reject')}
                        className="text-red-600 hover:text-red-700"
                      >
                        <X className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}