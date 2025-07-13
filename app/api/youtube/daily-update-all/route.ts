import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const headersList = await headers();
    const host = headersList.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;
    
    const { accessToken } = await request.json();
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Access token required' }, { status: 400 });
    }

    // Run all operations synchronously and return final results
    try {
      // Phase 1: RSS Monitoring for ALL channels (including your own)
      const rssResponse = await fetch(`${baseUrl}/api/youtube/daily-monitor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000000' })
      });

      const rssData = rssResponse.ok ? await rssResponse.json() : { 
        channelsProcessed: 0, 
        totalChannels: 0, 
        newVideos: 0 
      };

      // Phase 2: Recent Analytics Backfill (7 days max)
      const maxDaysBack = 7;
      const today = new Date();
      const fourDaysAgo = new Date(today.getTime() - (4 * 24 * 60 * 60 * 1000));
      const earliestDate = new Date(today.getTime() - (maxDaysBack * 24 * 60 * 60 * 1000));
      
      const gapsResponse = await fetch(`${baseUrl}/api/youtube/analytics/gaps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          startDate: earliestDate.toISOString().split('T')[0],
          endDate: fourDaysAgo.toISOString().split('T')[0]
        })
      });

      let backfillData = { daysProcessed: 0 };
      if (gapsResponse.ok) {
        const gapsData = await gapsResponse.json();
        const totalDaysToProcess = gapsData.gaps?.length || 0;

        if (totalDaysToProcess > 0) {
          const backfillResponse = await fetch(`${baseUrl}/api/youtube/analytics/historical-backfill`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({ 
              startDate: earliestDate.toISOString().split('T')[0],
              endDate: fourDaysAgo.toISOString().split('T')[0]
            })
          });

          if (backfillResponse.ok) {
            backfillData = { daysProcessed: totalDaysToProcess };
          }
        }
      }

      // Return final results immediately
      return NextResponse.json({
        success: true,
        message: 'Daily update completed successfully',
        results: {
          rss: {
            channelsProcessed: rssData.channelsProcessed || 0,
            totalChannels: rssData.totalChannels || 0,
            newVideos: rssData.newVideos || 0,
            status: 'complete'
          },
          analytics_backfill: {
            daysProcessed: backfillData.daysProcessed || 0,
            totalDays: backfillData.daysProcessed || 0,
            status: 'complete'
          }
        }
      });

    } catch (error) {
      console.error('Daily update error:', error);
      return NextResponse.json({
        success: false,
        error: 'Daily update failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Error starting daily update:', error);
    return NextResponse.json({ 
      error: 'Failed to start daily update',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Remove the GET endpoint entirely - no more polling!
export async function GET(request: NextRequest) {
  return NextResponse.json({ error: 'Polling not supported' }, { status: 404 });
}