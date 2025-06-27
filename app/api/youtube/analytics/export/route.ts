/**
 * YouTube Analytics Export API Route
 * Handles data export functionality
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const exportOptions = await request.json();
    const { format, dateRange, includeMetrics, selectedVideos } = exportOptions;

    const startDate = new Date(dateRange.from).toISOString().split('T')[0];
    const endDate = new Date(dateRange.to).toISOString().split('T')[0];

    // Build the query
    let query = supabase
      .from('daily_analytics')
      .select(`
        video_id,
        date,
        views,
        ctr,
        retention_avg,
        likes,
        comments,
        videos!inner(title, published_at)
      `)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });

    // Filter by selected videos if provided
    if (selectedVideos && selectedVideos.length > 0) {
      query = query.in('video_id', selectedVideos);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching export data:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'No data found for the specified criteria' },
        { status: 404 }
      );
    }

    // Transform data based on included metrics
    const transformedData = data.map(record => {
      const row: any = {
        video_id: record.video_id,
        title: (record.videos as any)?.title,
        published_date: (record.videos as any)?.published_at,
        date: record.date,
      };

      if (includeMetrics.views) row.views = record.views;
      if (includeMetrics.ctr) row.ctr = record.ctr;
      if (includeMetrics.retention) row.retention_avg = record.retention_avg;
      if (includeMetrics.likes) row.likes = record.likes;
      if (includeMetrics.comments) row.comments = record.comments;

      return row;
    });

    // Generate export based on format
    if (format === 'csv') {
      const csv = generateCSV(transformedData);
      
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="youtube-analytics-${endDate}.csv"`,
        },
      });
    } else if (format === 'json') {
      const json = JSON.stringify(transformedData, null, 2);
      
      return new NextResponse(json, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="youtube-analytics-${endDate}.json"`,
        },
      });
    }

    return NextResponse.json(
      { error: 'Unsupported export format' },
      { status: 400 }
    );

  } catch (error) {
    console.error('Error exporting data:', error);
    return NextResponse.json(
      { error: 'Failed to export data' },
      { status: 500 }
    );
  }
}

function generateCSV(data: any[]): string {
  if (data.length === 0) return '';

  // Get headers from the first row
  const headers = Object.keys(data[0]);
  
  // Create CSV content
  const csvRows = [
    headers.join(','), // Header row
    ...data.map(row => 
      headers.map(header => {
        const value = row[header];
        // Escape values that contain commas or quotes
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value ?? '';
      }).join(',')
    )
  ];

  return csvRows.join('\n');
}