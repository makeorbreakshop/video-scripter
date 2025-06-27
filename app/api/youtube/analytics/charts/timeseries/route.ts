/**
 * YouTube Analytics Charts Timeseries API Route
 * Returns time series data for charts
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');

    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get daily aggregated analytics data
    const { data, error } = await supabase
      .from('daily_analytics')
      .select('date, views, average_view_percentage, likes, comments')
      .gte('date', startDate)
      .order('date', { ascending: true });

    if (error) {
      console.error('Error fetching timeseries data:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      return NextResponse.json([]);
    }

    // Group by date and aggregate
    const groupedData = data.reduce((acc, record) => {
      const date = record.date;
      if (!acc[date]) {
        acc[date] = {
          date,
          views: 0,
          ctr: 0,
          retention: 0,
          likes: 0,
          comments: 0,
          ctrCount: 0,
          retentionCount: 0,
        };
      }

      acc[date].views += record.views || 0;
      acc[date].likes += record.likes || 0;
      acc[date].comments += record.comments || 0;

      if (record.ctr !== null && record.ctr !== undefined) {
        acc[date].ctr += record.ctr;
        acc[date].ctrCount += 1;
      }

      if (record.retention_avg !== null && record.retention_avg !== undefined) {
        acc[date].retention += record.retention_avg;
        acc[date].retentionCount += 1;
      }

      return acc;
    }, {} as Record<string, any>);

    // Convert to array and calculate averages
    const timeSeriesData = Object.values(groupedData).map((day: any) => ({
      date: day.date,
      views: day.views,
      ctr: day.ctrCount > 0 ? day.ctr / day.ctrCount : 0,
      retention: day.retentionCount > 0 ? day.retention / day.retentionCount : 0,
      likes: day.likes,
      comments: day.comments,
    }));

    return NextResponse.json(timeSeriesData);

  } catch (error) {
    console.error('Error fetching timeseries data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch timeseries data' },
      { status: 500 }
    );
  }
}