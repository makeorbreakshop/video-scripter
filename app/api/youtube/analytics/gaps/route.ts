import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { startDate, endDate } = await request.json();
    
    if (!startDate || !endDate) {
      return NextResponse.json({ 
        error: 'Start date and end date are required' 
      }, { status: 400 });
    }

    // Get existing dates in the specified range
    const { data: existingData, error } = await supabase
      .from('daily_analytics')
      .select('date')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date');

    if (error) {
      console.error('Error fetching existing dates:', error);
      return NextResponse.json({ 
        error: 'Failed to fetch existing dates' 
      }, { status: 500 });
    }

    const existingDates = new Set(existingData.map(row => row.date));
    
    // Generate all dates in the range
    const gaps = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      if (!existingDates.has(dateStr)) {
        gaps.push(dateStr);
      }
    }

    return NextResponse.json({
      success: true,
      gaps,
      totalDays: Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      existingDays: existingData.length,
      missingDays: gaps.length
    });

  } catch (error) {
    console.error('Gaps API error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    }, { status: 500 });
  }
}