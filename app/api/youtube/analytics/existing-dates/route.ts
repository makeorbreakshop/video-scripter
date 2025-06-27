/**
 * YouTube Analytics Existing Dates API Route
 * Returns list of dates that already have analytics data in daily_analytics table
 */

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Get distinct dates with video counts from daily_analytics table
    const { data, error } = await supabase
      .from('daily_analytics')
      .select('date')
      .not('date', 'is', null)
      .order('date', { ascending: false });

    if (error) {
      console.error('❌ Error fetching existing dates:', error);
      return NextResponse.json(
        { error: 'Failed to fetch existing dates' },
        { status: 500 }
      );
    }

    // Extract unique dates and sort them
    const uniqueDates = [...new Set(data?.map(row => row.date) || [])].sort();
    
    // Analyze gaps and provide smart suggestions
    const gapAnalysis = analyzeDataGaps(uniqueDates);

    console.log(`📅 Found ${uniqueDates.length} existing dates in daily_analytics`);
    console.log(`📊 Gap analysis: ${gapAnalysis.gaps.length} gaps found`);

    return NextResponse.json({
      success: true,
      dates: uniqueDates,
      count: uniqueDates.length,
      gapAnalysis
    });

  } catch (error) {
    console.error('❌ Existing dates API error:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        success: false 
      },
      { status: 500 }
    );
  }
}

/**
 * Analyze gaps in the data and provide smart suggestions
 */
function analyzeDataGaps(existingDates: string[]) {
  if (existingDates.length === 0) {
    return {
      lastSuccessfulDate: null,
      nextMissingDate: null,
      recommendedRange: null,
      gaps: [],
      suggestions: {
        primary: "No data found. Start with a recent date range.",
        secondary: "Consider starting 4+ days ago due to Analytics API delay."
      }
    };
  }

  const sortedDates = existingDates.sort();
  const lastSuccessfulDate = sortedDates[sortedDates.length - 1];
  
  // Find gaps in the date sequence
  const gaps = findDateGaps(sortedDates);
  
  // Find the next missing date after the last successful one
  const nextMissingDate = findNextMissingDate(lastSuccessfulDate);
  
  // Get recommended range for the biggest gap or next missing dates
  const recommendedRange = getRecommendedRange(gaps, nextMissingDate);
  
  // Generate helpful suggestions
  const suggestions = generateSuggestions(lastSuccessfulDate, nextMissingDate, gaps);

  return {
    lastSuccessfulDate,
    nextMissingDate,
    recommendedRange,
    gaps,
    suggestions
  };
}

/**
 * Find gaps in date sequence
 */
function findDateGaps(sortedDates: string[]) {
  const gaps = [];
  
  for (let i = 0; i < sortedDates.length - 1; i++) {
    const currentDate = new Date(sortedDates[i]);
    const nextDate = new Date(sortedDates[i + 1]);
    const daysBetween = Math.floor((nextDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysBetween > 1) {
      const gapStart = new Date(currentDate);
      gapStart.setDate(gapStart.getDate() + 1);
      const gapEnd = new Date(nextDate);
      gapEnd.setDate(gapEnd.getDate() - 1);
      
      gaps.push({
        startDate: gapStart.toISOString().split('T')[0],
        endDate: gapEnd.toISOString().split('T')[0],
        dayCount: daysBetween - 1
      });
    }
  }
  
  return gaps;
}

/**
 * Find next missing date after the last successful date
 */
function findNextMissingDate(lastSuccessfulDate: string) {
  const nextDay = new Date(lastSuccessfulDate);
  nextDay.setDate(nextDay.getDate() + 1);
  return nextDay.toISOString().split('T')[0];
}

/**
 * Get recommended date range for backfill
 */
function getRecommendedRange(gaps: any[], nextMissingDate: string) {
  // If there are gaps, recommend the largest gap
  if (gaps.length > 0) {
    const largestGap = gaps.reduce((max, gap) => 
      gap.dayCount > max.dayCount ? gap : max
    );
    return {
      startDate: largestGap.startDate,
      endDate: largestGap.endDate,
      reason: `Largest gap (${largestGap.dayCount} days)`
    };
  }
  
  // Otherwise, suggest continuing from next missing date
  const today = new Date();
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() - 4); // Analytics API 4-day delay
  
  const endDate = maxDate.toISOString().split('T')[0];
  
  if (nextMissingDate <= endDate) {
    return {
      startDate: nextMissingDate,
      endDate,
      reason: "Continue from last successful date"
    };
  }
  
  return null;
}

/**
 * Generate helpful suggestions for the user
 */
function generateSuggestions(lastSuccessfulDate: string, nextMissingDate: string, gaps: any[]) {
  if (gaps.length > 0) {
    const totalMissingDays = gaps.reduce((sum, gap) => sum + gap.dayCount, 0);
    return {
      primary: `Last successful: ${lastSuccessfulDate}. Found ${gaps.length} gap(s) totaling ${totalMissingDays} days.`,
      secondary: `Largest gap: ${gaps[0]?.startDate} to ${gaps[0]?.endDate} (${gaps[0]?.dayCount} days)`
    };
  }
  
  const today = new Date();
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() - 4);
  const maxDateStr = maxDate.toISOString().split('T')[0];
  
  if (nextMissingDate <= maxDateStr) {
    const daysDiff = Math.floor((new Date(maxDateStr).getTime() - new Date(nextMissingDate).getTime()) / (1000 * 60 * 60 * 24));
    return {
      primary: `Last successful: ${lastSuccessfulDate}. Ready to continue from ${nextMissingDate}.`,
      secondary: `Can backfill ${daysDiff + 1} days up to ${maxDateStr}`
    };
  }
  
  return {
    primary: `Last successful: ${lastSuccessfulDate}. Data is current.`,
    secondary: "All recent dates are processed. Wait 4+ days for new data availability."
  };
}