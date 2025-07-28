import { NextRequest, NextResponse } from 'next/server';

// Mock data for now - in production this would come from a database
const mockRecentResults = [
  {
    query: "machine learning tutorial",
    timestamp: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 minutes ago
    channelsFound: 8,
    channelsAdded: 6,
    duplicates: 2,
    topResult: {
      title: "3Blue1Brown",
      subscribers: 5200000,
      autoApproved: true
    }
  },
  {
    query: "physics explained simply",
    timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
    channelsFound: 12,
    channelsAdded: 9,
    duplicates: 3,
    topResult: {
      title: "MinutePhysics",
      subscribers: 2800000,
      autoApproved: true
    }
  },
  {
    query: "data science beginners",
    timestamp: new Date(Date.now() - 45 * 60 * 1000).toISOString(), // 45 minutes ago
    channelsFound: 6,
    channelsAdded: 4,
    duplicates: 2,
    topResult: {
      title: "StatQuest with Josh Starmer",
      subscribers: 1100000,
      autoApproved: true
    }
  }
];

export async function GET(request: NextRequest) {
  try {
    // In production, this would query a database table storing search results
    // For now, return mock data
    
    return NextResponse.json({
      success: true,
      results: mockRecentResults
    });

  } catch (error) {
    console.error('Error fetching recent results:', error);
    return NextResponse.json(
      { error: 'Failed to fetch recent results' },
      { status: 500 }
    );
  }
}