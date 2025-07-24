'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { FileVideo, Hash } from 'lucide-react';

interface FormatBreakdownProps {
  channelName: string;
}

export function FormatBreakdown({ channelName }: FormatBreakdownProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/channel/format-analysis?channel=${encodeURIComponent(channelName)}`)
      .then(res => res.json())
      .then(data => {
        setData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading format data:', err);
        setLoading(false);
      });
  }, [channelName]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-[400px]">
          <div className="animate-pulse text-muted-foreground">Analyzing formats...</div>
        </CardContent>
      </Card>
    );
  }

  const formatColors: Record<string, string> = {
    'product_focus': '#8884d8',
    'tutorial': '#82ca9d',
    'news_analysis': '#ffc658',
    'explainer': '#ff7c7c',
    'listicle': '#8dd1e1',
    'case_study': '#d084d0',
    'personal_story': '#ffb347',
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileVideo className="w-5 h-5" />
            Format Performance
          </CardTitle>
          <CardDescription>
            Average views by content format
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart 
                data={data?.formats || []}
                layout="horizontal"
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="format" type="category" width={100} />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload?.[0]) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-background border rounded p-3 shadow-lg">
                          <p className="text-sm font-medium capitalize">
                            {data.format.replace('_', ' ')}
                          </p>
                          <p className="text-xs">Videos: {data.count}</p>
                          <p className="text-xs">Avg Views: {data.avgViews?.toLocaleString()}</p>
                          {data.topVideo && (
                            <div className="mt-2 pt-2 border-t">
                              <p className="text-xs text-muted-foreground">Top Video:</p>
                              <p className="text-xs truncate max-w-[200px]">{data.topVideo.title}</p>
                              <p className="text-xs">{data.topVideo.views?.toLocaleString()} views</p>
                            </div>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar 
                  dataKey="avgViews" 
                  fill={(entry: any) => formatColors[entry.format] || '#8884d8'}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Hash className="w-5 h-5" />
            Content Mix
          </CardTitle>
          <CardDescription>
            Distribution of video formats
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data?.formats?.slice(0, 6).map((format: any, index: number) => {
              const percentage = (format.count / data.summary.totalVideosAnalyzed) * 100;
              return (
                <div key={format.format} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium capitalize">
                        {format.format.replace(/_/g, ' ')}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {format.count} videos
                      </Badge>
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {percentage.toFixed(1)}%
                    </span>
                  </div>
                  <Progress 
                    value={percentage} 
                    className="h-2"
                    style={{
                      '--progress-background': formatColors[format.format] || '#8884d8',
                    } as any}
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-6 p-4 bg-muted rounded-lg">
            <h4 className="text-sm font-medium mb-2">Top Performing Format</h4>
            <p className="text-2xl font-bold capitalize">
              {data?.summary?.bestPerformingFormat?.format.replace(/_/g, ' ')}
            </p>
            <p className="text-sm text-muted-foreground">
              {data?.summary?.bestPerformingFormat?.avgViews?.toLocaleString()} avg views
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}