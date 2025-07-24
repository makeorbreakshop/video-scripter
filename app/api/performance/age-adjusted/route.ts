import { NextResponse } from 'next/server';
import { calculateAgeAdjustedPerformance } from '@/lib/age-adjusted-performance';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channelName = searchParams.get('channel') || 'Make or Break Shop';
  const limit = parseInt(searchParams.get('limit') || '20');
  const timeframe = searchParams.get('timeframe') || '30d';

  try {
    const performances = await calculateAgeAdjustedPerformance(channelName, limit, timeframe);
    
    // Add summary statistics
    const summary = {
      channel: channelName,
      totalVideos: performances.length,
      medianVpd: performances[0]?.channelMedianVpd || 0,
      performanceBreakdown: {
        exceptional: performances.filter(p => p.performanceTier.includes('Exceptional')).length,
        strong: performances.filter(p => p.performanceTier.includes('Strong')).length,
        aboveAverage: performances.filter(p => p.performanceTier.includes('Above Average')).length,
        belowAverage: performances.filter(p => p.performanceTier.includes('Below Average')).length,
        needsAttention: performances.filter(p => p.performanceTier.includes('Needs Attention')).length,
      }
    };

    return NextResponse.json({
      summary,
      videos: performances
    });
  } catch (error) {
    console.error('Error calculating age-adjusted performance:', error);
    return NextResponse.json(
      { error: 'Failed to calculate performance' },
      { status: 500 }
    );
  }
}