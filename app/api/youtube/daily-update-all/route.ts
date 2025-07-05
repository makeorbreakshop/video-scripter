import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

interface DailyUpdateProgress {
  phase: 'discovery' | 'backfill' | 'rss' | 'complete';
  phaseNumber: number;
  totalPhases: number;
  overallProgress: number;
  phaseProgress: number;
  currentOperation: string;
  startTime: number;
  estimatedTimeRemaining?: string;
  results: {
    discovery: {
      newVideos: number;
      status: 'pending' | 'running' | 'complete' | 'error';
      error?: string;
    };
    backfill: {
      daysProcessed: number;
      totalDays: number;
      status: 'pending' | 'running' | 'complete' | 'error';
      error?: string;
    };
    rss: {
      channelsProcessed: number;
      totalChannels: number;
      newVideos: number;
      status: 'pending' | 'running' | 'complete' | 'error';
      error?: string;
    };
  };
}

const progressStore = new Map<string, DailyUpdateProgress>();

export async function POST(request: NextRequest) {
  try {
    const headersList = await headers();
    const host = headersList.get('host') || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const baseUrl = `${protocol}://${host}`;
    
    // No authentication check needed for now - will be handled by individual endpoints

    const { accessToken } = await request.json();
    
    if (!accessToken) {
      return NextResponse.json({ error: 'Access token required' }, { status: 400 });
    }

    const operationId = `daily-update-${Date.now()}`;
    
    const initialProgress: DailyUpdateProgress = {
      phase: 'discovery',
      phaseNumber: 1,
      totalPhases: 3,
      overallProgress: 0,
      phaseProgress: 0,
      currentOperation: 'Initializing daily update...',
      startTime: Date.now(),
      results: {
        discovery: { newVideos: 0, status: 'pending' },
        backfill: { daysProcessed: 0, totalDays: 0, status: 'pending' },
        rss: { channelsProcessed: 0, totalChannels: 0, newVideos: 0, status: 'pending' }
      }
    };

    progressStore.set(operationId, initialProgress);

    processDaily(operationId, accessToken, baseUrl).catch(console.error);

    return NextResponse.json({ 
      success: true, 
      operationId,
      message: 'Daily update started successfully'
    });

  } catch (error) {
    console.error('Error starting daily update:', error);
    return NextResponse.json({ 
      error: 'Failed to start daily update',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const operationId = searchParams.get('operationId');

  if (!operationId) {
    return NextResponse.json({ error: 'Operation ID required' }, { status: 400 });
  }

  const progress = progressStore.get(operationId);
  
  if (!progress) {
    return NextResponse.json({ error: 'Operation not found' }, { status: 404 });
  }

  return NextResponse.json(progress);
}

async function processDaily(operationId: string, accessToken: string, baseUrl: string) {
  const updateProgress = (updates: Partial<DailyUpdateProgress>) => {
    const current = progressStore.get(operationId);
    if (current) {
      progressStore.set(operationId, { ...current, ...updates });
    }
  };

  try {
    // Phase 1: Channel Discovery
    updateProgress({
      phase: 'discovery',
      phaseNumber: 1,
      overallProgress: 5,
      phaseProgress: 0,
      currentOperation: 'Discovering new videos from your channel...',
      results: {
        ...progressStore.get(operationId)!.results,
        discovery: { newVideos: 0, status: 'running' }
      }
    });

    const discoveryResponse = await fetch(`${baseUrl}/api/youtube/discover-new-videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken })
    });

    if (!discoveryResponse.ok) {
      throw new Error(`Discovery failed: ${await discoveryResponse.text()}`);
    }

    const discoveryData = await discoveryResponse.json();
    
    updateProgress({
      overallProgress: 30,
      phaseProgress: 100,
      currentOperation: `Discovered ${discoveryData.newVideos || 0} new videos`,
      results: {
        ...progressStore.get(operationId)!.results,
        discovery: { 
          newVideos: discoveryData.newVideos || 0, 
          status: 'complete' 
        }
      }
    });

    // Phase 2: Recent Analytics Backfill (7 days max)
    updateProgress({
      phase: 'backfill',
      phaseNumber: 2,
      overallProgress: 35,
      phaseProgress: 0,
      currentOperation: 'Checking for recent analytics gaps...',
      results: {
        ...progressStore.get(operationId)!.results,
        backfill: { daysProcessed: 0, totalDays: 0, status: 'running' }
      }
    });

    const maxDaysBack = 7;
    const today = new Date();
    const fourDaysAgo = new Date(today.getTime() - (4 * 24 * 60 * 60 * 1000)); // YouTube Analytics 4-day delay
    const earliestDate = new Date(today.getTime() - (maxDaysBack * 24 * 60 * 60 * 1000));
    
    const gapsResponse = await fetch(`${baseUrl}/api/youtube/analytics/gaps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        startDate: earliestDate.toISOString().split('T')[0],
        endDate: fourDaysAgo.toISOString().split('T')[0]
      })
    });

    let totalDaysToProcess = 0;
    if (gapsResponse.ok) {
      const gapsData = await gapsResponse.json();
      totalDaysToProcess = gapsData.gaps?.length || 0;
    }

    if (totalDaysToProcess > 0) {
      updateProgress({
        overallProgress: 40,
        currentOperation: `Processing ${totalDaysToProcess} recent analytics gaps...`,
        results: {
          ...progressStore.get(operationId)!.results,
          backfill: { 
            daysProcessed: 0, 
            totalDays: totalDaysToProcess, 
            status: 'running' 
          }
        }
      });

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

      if (!backfillResponse.ok) {
        throw new Error(`Backfill failed: ${await backfillResponse.text()}`);
      }

      const backfillData = await backfillResponse.json();
      
      updateProgress({
        overallProgress: 65,
        phaseProgress: 100,
        currentOperation: `Processed ${totalDaysToProcess} days of recent analytics`,
        results: {
          ...progressStore.get(operationId)!.results,
          backfill: { 
            daysProcessed: totalDaysToProcess, 
            totalDays: totalDaysToProcess, 
            status: 'complete' 
          }
        }
      });
    } else {
      updateProgress({
        overallProgress: 65,
        phaseProgress: 100,
        currentOperation: 'No recent analytics gaps found',
        results: {
          ...progressStore.get(operationId)!.results,
          backfill: { 
            daysProcessed: 0, 
            totalDays: 0, 
            status: 'complete' 
          }
        }
      });
    }

    // Phase 3: RSS Monitoring
    updateProgress({
      phase: 'rss',
      phaseNumber: 3,
      overallProgress: 70,
      phaseProgress: 0,
      currentOperation: 'Monitoring competitor channels for new videos...',
      results: {
        ...progressStore.get(operationId)!.results,
        rss: { channelsProcessed: 0, totalChannels: 0, newVideos: 0, status: 'running' }
      }
    });

    const rssResponse = await fetch(`${baseUrl}/api/youtube/daily-monitor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        userId: '00000000-0000-0000-0000-000000000000' 
      })
    });

    if (!rssResponse.ok) {
      throw new Error(`RSS monitoring failed: ${await rssResponse.text()}`);
    }

    const rssData = await rssResponse.json();
    
    updateProgress({
      phase: 'complete',
      overallProgress: 100,
      phaseProgress: 100,
      currentOperation: 'Daily update completed successfully',
      results: {
        ...progressStore.get(operationId)!.results,
        rss: { 
          channelsProcessed: rssData.channelsProcessed || 0,
          totalChannels: rssData.totalChannels || 0,
          newVideos: rssData.newVideos || 0,
          status: 'complete' 
        }
      }
    });

  } catch (error) {
    console.error('Daily update error:', error);
    
    const current = progressStore.get(operationId);
    if (current) {
      const currentPhase = current.phase;
      updateProgress({
        currentOperation: `Error in ${currentPhase} phase: ${error instanceof Error ? error.message : 'Unknown error'}`,
        results: {
          ...current.results,
          [currentPhase]: {
            ...current.results[currentPhase as keyof typeof current.results],
            status: 'error' as const,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        }
      });
    }
  }
}