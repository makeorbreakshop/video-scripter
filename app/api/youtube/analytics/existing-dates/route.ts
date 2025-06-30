/**
 * YouTube Analytics Existing Dates API Route
 * Returns list of dates that already have analytics data in daily_analytics table
 */

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Use the SQL function to get distinct dates
    const { data, error } = await supabase
      .rpc('get_distinct_analytics_dates');

    if (error) {
      console.error('❌ Error fetching existing dates:', error);
      return NextResponse.json(
        { error: 'Failed to fetch existing dates' },
        { status: 500 }
      );
    }

    console.log(`🔍 Raw data from function: ${data?.length} rows`);
    console.log(`🔍 First 5 dates: ${data?.slice(0, 5).map(d => d.date).join(', ')}`);
    
    // Data is already distinct and sorted from the function
    const uniqueDates = data?.map(row => row.date) || [];
    
    // Analyze gaps and provide smart suggestions
    const gapAnalysis = analyzeDataGaps(uniqueDates);
    
    // Add comprehensive data coverage analysis
    const dataCoverage = await analyzeDataCoverage(uniqueDates);

    console.log(`📅 Found ${uniqueDates.length} existing dates in daily_analytics`);
    console.log(`📊 Gap analysis: ${gapAnalysis.gaps.length} gaps found`);
    console.log(`📈 Data coverage: ${dataCoverage.coveragePercent}% (${dataCoverage.oldestDate} to ${dataCoverage.newestDate})`);

    return NextResponse.json({
      success: true,
      dates: uniqueDates,
      count: uniqueDates.length,
      gapAnalysis,
      dataCoverage
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
 * Analyze comprehensive data coverage and provide backward fill recommendations
 */
async function analyzeDataCoverage(existingDates: string[]) {
  if (existingDates.length === 0) {
    return {
      oldestDate: null,
      newestDate: null,
      totalDays: 0,
      expectedDays: 0,
      coveragePercent: 0,
      missingDays: 0,
      daysSinceOldest: 0,
      backwardFillRecommendation: {
        strategy: 'fresh_start',
        suggestedDaysBack: 30,
        recommendedStartDate: null,
        recommendedEndDate: null,
        utilizationTarget: 85,
        reasoning: 'No existing data - start with recent 30-day period'
      }
    };
  }

  const sortedDates = existingDates.sort();
  const oldestDate = sortedDates[0];
  const newestDate = sortedDates[sortedDates.length - 1];
  
  // Calculate date range and coverage
  const oldestDateObj = new Date(oldestDate);
  const newestDateObj = new Date(newestDate);
  const totalDaysInRange = Math.floor((newestDateObj.getTime() - oldestDateObj.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const coveragePercent = Math.round((existingDates.length / totalDaysInRange) * 100);
  const missingDays = totalDaysInRange - existingDates.length;
  
  // Calculate days since oldest data
  const daysSinceOldest = Math.floor((Date.now() - oldestDateObj.getTime()) / (1000 * 60 * 60 * 24));
  
  // Generate backward fill recommendation
  let strategy, suggestedDaysBack, utilizationTarget, reasoning;
  
  if (daysSinceOldest < 7) {
    strategy = 'recent_data';
    suggestedDaysBack = 30;
    utilizationTarget = 85;
    reasoning = 'Recent data - safe to use aggressive settings';
  } else if (daysSinceOldest < 30) {
    strategy = 'moderate_age';
    suggestedDaysBack = 60;
    utilizationTarget = 75;
    reasoning = 'Moderate age data - use current settings';
  } else if (daysSinceOldest < 365) {
    strategy = 'older_data';
    suggestedDaysBack = 90;
    utilizationTarget = 70;
    reasoning = 'Older data - reduce utilization for stability';
  } else {
    strategy = 'historical_data';
    suggestedDaysBack = 180;
    utilizationTarget = 65;
    reasoning = 'Historical data - use conservative settings';
  }
  
  // Calculate recommended date range
  const recommendedStartDate = new Date(oldestDateObj);
  recommendedStartDate.setDate(recommendedStartDate.getDate() - suggestedDaysBack);
  const recommendedStart = recommendedStartDate.toISOString().split('T')[0];
  
  return {
    oldestDate,
    newestDate,
    totalDays: existingDates.length,
    expectedDays: totalDaysInRange,
    coveragePercent,
    missingDays,
    daysSinceOldest,
    backwardFillRecommendation: {
      strategy,
      suggestedDaysBack,
      recommendedStartDate: recommendedStart,
      recommendedEndDate: oldestDate,
      utilizationTarget,
      reasoning,
      estimatedVideos: suggestedDaysBack * 215,
      estimatedTimeHours: Math.round((suggestedDaysBack * 215) / 34100 * 10) / 10 // Based on proven 568.4 videos/min (34,100/hour)
    }
  };
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