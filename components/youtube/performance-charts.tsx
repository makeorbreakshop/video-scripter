/**
 * Performance Charts Component
 * Displays analytics charts using shadcn Chart components with Recharts
 */

'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { ChartData } from './types';

const chartConfig = {
  views: {
    label: 'Views',
    color: 'hsl(var(--chart-1))',
  },
  ctr: {
    label: 'CTR',
    color: 'hsl(var(--chart-2))',
  },
  retention: {
    label: 'Retention',
    color: 'hsl(var(--chart-3))',
  },
  likes: {
    label: 'Likes',
    color: 'hsl(var(--chart-4))',
  },
} satisfies ChartConfig;

export function PerformanceCharts() {
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [topPerformers, setTopPerformers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchChartData();
  }, []);

  const fetchChartData = async () => {
    try {
      setLoading(true);
      
      // Fetch time series data
      const timeSeriesResponse = await fetch('/api/youtube/analytics/charts/timeseries');
      if (timeSeriesResponse.ok) {
        const timeSeriesData = await timeSeriesResponse.json();
        setChartData(timeSeriesData);
      }

      // Fetch top performers
      const topPerformersResponse = await fetch('/api/youtube/analytics/charts/top-performers');
      if (topPerformersResponse.ok) {
        const topPerformersData = await topPerformersResponse.json();
        setTopPerformers(topPerformersData);
      }

    } catch (error) {
      console.error('Error fetching chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <ChartsSkeleton />;
  }

  return (
    <>
      {/* Views Over Time */}
      <Card>
        <CardHeader>
          <CardTitle>Views Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig}>
            <LineChart
              data={chartData}
              margin={{
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  });
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => `${value.toLocaleString()}`}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent />}
              />
              <Line
                dataKey="views"
                type="monotone"
                stroke="var(--color-views)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* CTR Trends */}
      <Card>
        <CardHeader>
          <CardTitle>CTR & Retention Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig}>
            <AreaChart
              data={chartData}
              margin={{
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  });
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => `${(value * 100).toFixed(1)}%`}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent />}
              />
              <defs>
                <linearGradient id="fillCtr" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-ctr)"
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-ctr)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
                <linearGradient id="fillRetention" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-retention)"
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-retention)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
              <Area
                dataKey="ctr"
                type="monotone"
                fill="url(#fillCtr)"
                fillOpacity={0.4}
                stroke="var(--color-ctr)"
                stackId="a"
              />
              <Area
                dataKey="retention"
                type="monotone"
                fill="url(#fillRetention)"
                fillOpacity={0.4}
                stroke="var(--color-retention)"
                stackId="b"
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Top Performers */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Top Performing Videos (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig}>
            <BarChart
              data={topPerformers}
              layout="horizontal"
              margin={{
                left: 12,
                right: 12,
              }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type="number"
                dataKey="views"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value) => `${value.toLocaleString()}`}
              />
              <YAxis
                type="category"
                dataKey="title"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                width={200}
                tickFormatter={(value) => {
                  if (typeof value === 'string' && value.length > 30) {
                    return value.substring(0, 30) + '...';
                  }
                  return value;
                }}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent />}
              />
              <Bar dataKey="views" fill="var(--color-views)" />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </>
  );
}

function ChartsSkeleton() {
  return (
    <>
      {[...Array(3)].map((_, i) => (
        <Card key={i} className={i === 2 ? 'md:col-span-2' : ''}>
          <CardHeader>
            <div className="h-6 w-32 bg-muted animate-pulse rounded" />
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
      ))}
    </>
  );
}