import { NextRequest, NextResponse } from 'next/server';
import { quotaTracker } from '@/lib/youtube-quota-tracker';

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    
    switch (action) {
      case 'status':
        const status = await quotaTracker.getQuotaStatus();
        return NextResponse.json(status);
        
      case 'breakdown':
        const breakdown = await quotaTracker.getCallBreakdown();
        return NextResponse.json(breakdown);
        
      case 'summary':
        const days = parseInt(url.searchParams.get('days') || '7');
        const summary = await quotaTracker.getUsageSummary(days);
        return NextResponse.json(summary);
        
      default:
        // Return comprehensive quota information
        const [quotaStatus, callBreakdown, usageSummary] = await Promise.all([
          quotaTracker.getQuotaStatus(),
          quotaTracker.getCallBreakdown(),
          quotaTracker.getUsageSummary(7)
        ]);
        
        return NextResponse.json({
          status: quotaStatus,
          todaysCalls: callBreakdown,
          recentUsage: usageSummary
        });
    }
  } catch (error) {
    console.error('Error in quota status endpoint:', error);
    return NextResponse.json(
      { error: 'Failed to get quota status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...params } = body;
    
    switch (action) {
      case 'estimate':
        const { channelId } = params;
        if (!channelId) {
          return NextResponse.json(
            { error: 'Channel ID required' },
            { status: 400 }
          );
        }
        
        const estimate = await quotaTracker.estimateChannelQuota(channelId);
        return NextResponse.json(estimate);
        
      case 'check':
        const { estimatedCost } = params;
        if (!estimatedCost) {
          return NextResponse.json(
            { error: 'Estimated cost required' },
            { status: 400 }
          );
        }
        
        const available = await quotaTracker.checkQuotaAvailable(estimatedCost);
        return NextResponse.json({ available });
        
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Error in quota status POST:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}