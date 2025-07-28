import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Check quota first
    const quotaResponse = await fetch(`${request.nextUrl.origin}/api/google-pse/quota`);
    if (!quotaResponse.ok) {
      throw new Error('Failed to check quota');
    }
    
    const quotaData = await quotaResponse.json();
    if (quotaData.quota.remaining <= 0) {
      return NextResponse.json(
        { error: 'Daily quota exceeded' },
        { status: 429 }
      );
    }

    // For now, return mock results
    // In production, this would:
    // 1. Call the actual Google PSE API
    // 2. Process results and find YouTube channels
    // 3. Store results in database
    // 4. Update quota usage
    
    const mockResult = {
      query,
      channelsFound: Math.floor(Math.random() * 10) + 3, // 3-12 channels
      channelsAdded: Math.floor(Math.random() * 8) + 2,  // 2-9 new channels
      duplicates: Math.floor(Math.random() * 3),         // 0-2 duplicates
      topResult: {
        title: query.includes('machine') ? "3Blue1Brown" : 
               query.includes('physics') ? "MinutePhysics" :
               query.includes('data') ? "StatQuest" : "TED-Ed",
        subscribers: Math.floor(Math.random() * 5000000) + 500000,
        autoApproved: Math.random() > 0.3 // 70% chance of auto-approval
      },
      timestamp: new Date().toISOString()
    };

    console.log(`🔍 PSE Search: "${query}" found ${mockResult.channelsFound} channels`);

    return NextResponse.json({
      success: true,
      ...mockResult
    });

  } catch (error) {
    console.error('PSE search error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}