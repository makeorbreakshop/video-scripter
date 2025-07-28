import { NextRequest, NextResponse } from 'next/server';

// Mock data for now - in production this would aggregate from database
const mockWeeklyStats = {
  searchesPerformed: 47,
  searchesLimit: 700, // 100/day * 7 days
  channelsDiscovered: 134,
  approvalRate: 72,
  bestSearch: {
    query: "physics explained",
    channelsFound: 12
  }
};

export async function GET(request: NextRequest) {
  try {
    // In production, this would aggregate data from:
    // - PSE search logs
    // - Channel discovery table 
    // - Approval/rejection rates
    
    return NextResponse.json({
      success: true,
      stats: mockWeeklyStats
    });

  } catch (error) {
    console.error('Error fetching weekly stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weekly stats' },
      { status: 500 }
    );
  }
}