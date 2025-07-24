import { NextResponse } from 'next/server';
import { calculateHybridPerformance } from '@/lib/hybrid-performance-score';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channelName = searchParams.get('channel') || 'Make or Break Shop';
  const limit = parseInt(searchParams.get('limit') || '50');
  const timeframe = searchParams.get('timeframe') || 'all';

  try {
    const performances = await calculateHybridPerformance(channelName, limit, timeframe);
    
    // Calculate median VPD
    const vpds = performances.map(p => p.currentVpd).sort((a, b) => a - b);
    const medianVpd = vpds.length > 0 ? vpds[Math.floor(vpds.length / 2)] : 0;
    
    // Add summary statistics
    const summary = {
      channel: channelName,
      totalVideos: performances.length,
      medianVpd: Math.round(medianVpd),
      performanceBreakdown: {
        viral: performances.filter(p => p.performanceTier.includes('Viral')).length,
        strong: performances.filter(p => p.performanceTier.includes('Strong')).length,
        aboveAverage: performances.filter(p => p.performanceTier.includes('Above Average')).length,
        average: performances.filter(p => p.performanceTier.includes('Average') && !p.performanceTier.includes('Above') && !p.performanceTier.includes('Below')).length,
        belowAverage: performances.filter(p => p.performanceTier.includes('Below')).length,
        needsAttention: performances.filter(p => p.performanceTier.includes('Needs Attention')).length,
      },
      trendBreakdown: {
        accelerating: performances.filter(p => p.trendDirection === '↗️').length,
        stable: performances.filter(p => p.trendDirection === '→').length,
        decelerating: performances.filter(p => p.trendDirection === '↘️').length,
      },
      avgCurrentVpd: Math.round(performances.reduce((sum, p) => sum + p.currentVpd, 0) / performances.length) || 0,
      avgIndexedScore: Number((performances.reduce((sum, p) => sum + p.indexedScore, 0) / performances.length).toFixed(2)) || 0,
    };

    return NextResponse.json({
      summary,
      videos: performances
    });
  } catch (error) {
    console.error('Error calculating hybrid performance:', error);
    return NextResponse.json(
      { error: 'Failed to calculate performance' },
      { status: 500 }
    );
  }
}