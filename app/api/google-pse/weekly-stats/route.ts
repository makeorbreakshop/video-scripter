import { NextResponse } from 'next/server';

export async function GET() {
  // For now, return mock stats
  // In production, this would fetch from database
  return NextResponse.json({
    success: true,
    stats: {
      searchesPerformed: 0,
      searchesLimit: 700,
      channelsDiscovered: 0,
      approvalRate: 0,
      bestSearch: { query: '', channelsFound: 0 }
    }
  });
}