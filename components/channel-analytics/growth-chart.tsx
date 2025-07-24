'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { TrendingUp } from 'lucide-react';

interface GrowthChartProps {
  channelName: string;
}

export function GrowthChart({ channelName }: GrowthChartProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/channel/growth-timeline?channel=${encodeURIComponent(channelName)}`)
      .then(res => res.json())
      .then(data => {
        setData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading growth data:', err);
        setLoading(false);
      });
  }, [channelName]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-[400px]">
          <div className="animate-pulse text-muted-foreground">Loading growth data...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Channel Growth Timeline</CardTitle>
            <CardDescription>
              Monthly average views and cumulative channel growth
            </CardDescription>
          </div>
          {data?.summary?.growthRate > 0 && (
            <div className="flex items-center gap-2 text-green-600">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">+{data.summary.growthRate}%</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data?.timeline || []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 12 }}
                interval="preserveStartEnd"
              />
              <YAxis 
                yAxisId="left"
                tick={{ fontSize: 12 }}
                label={{ value: 'Avg Views per Video', angle: -90, position: 'insideLeft' }}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12 }}
                label={{ value: 'Cumulative Views', angle: 90, position: 'insideRight' }}
              />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload?.[0]) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-background border rounded p-3 shadow-lg">
                        <p className="text-sm font-medium">{data.month}</p>
                        <p className="text-xs">Videos: {data.videos}</p>
                        <p className="text-xs">Avg Views: {data.avgViews?.toLocaleString()}</p>
                        <p className="text-xs">Total Views: {data.cumulativeViews?.toLocaleString()}</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="avgViews" 
                stroke="#8884d8" 
                strokeWidth={2}
                name="Avg Views"
                dot={{ r: 3 }}
              />
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="cumulativeViews" 
                stroke="#82ca9d" 
                strokeWidth={2}
                name="Cumulative"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t">
          <div className="text-center">
            <p className="text-2xl font-bold">{data?.summary?.totalVideos || 0}</p>
            <p className="text-xs text-muted-foreground">Total Videos</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">
              {(data?.summary?.totalChannelViews / 1000000).toFixed(1)}M
            </p>
            <p className="text-xs text-muted-foreground">Total Views</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">
              {(data?.summary?.recentAvgViews / 1000).toFixed(1)}K
            </p>
            <p className="text-xs text-muted-foreground">Recent Avg</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}