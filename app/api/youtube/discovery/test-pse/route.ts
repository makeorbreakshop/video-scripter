/**
 * Test Google PSE Configuration
 * Endpoint to verify Google PSE is properly set up
 */

import { NextRequest, NextResponse } from 'next/server';
import { googlePSE } from '@/lib/google-pse-service';

export async function GET(request: NextRequest) {
  try {
    // Check if configured
    const isConfigured = googlePSE.isConfigured();
    
    if (!isConfigured) {
      return NextResponse.json({
        configured: false,
        error: 'Google PSE not configured',
        instructions: {
          step1: 'Create a Programmable Search Engine at https://programmablesearchengine.google.com',
          step2: 'Add *.youtube.com/* to sites to search',
          step3: 'Get your Search Engine ID',
          step4: 'Create API key at https://console.cloud.google.com/apis/credentials',
          step5: 'Add to .env.local:',
          env: {
            GOOGLE_PSE_API_KEY: 'your_api_key_here',
            GOOGLE_PSE_ENGINE_ID: 'your_search_engine_id_here'
          }
        }
      }, { status: 500 });
    }

    // Run a test search
    const testQuery = 'python tutorial for beginners 2025';
    const result = await googlePSE.searchYouTube(testQuery, { num: 5 });
    
    if (result.error) {
      return NextResponse.json({
        configured: true,
        testFailed: true,
        error: result.error,
        troubleshooting: {
          checkAPIKey: 'Ensure your API key is valid',
          checkEngineId: 'Ensure your Search Engine ID is correct',
          checkQuota: 'You may have exceeded the 100/day limit',
          checkBilling: 'Ensure Custom Search API is enabled in Google Cloud Console'
        }
      }, { status: 500 });
    }

    // Get quota status
    const quotaStatus = await googlePSE.getQuotaStatus();

    return NextResponse.json({
      configured: true,
      testSuccess: true,
      testQuery,
      channelsFound: result.results.length,
      channels: result.results.map(ch => ({
        channelId: ch.channelId,
        channelName: ch.channelName,
        confidence: ch.confidence,
        source: ch.source
      })),
      quotaStatus,
      readyToUse: true,
      nextSteps: [
        'Run /api/youtube/discovery/orchestrator to start discovery',
        'Or use /api/youtube/discovery/batch-search directly',
        'Monitor quota usage (100 searches/day free)'
      ]
    });

  } catch (error) {
    console.error('PSE test error:', error);
    return NextResponse.json({
      configured: googlePSE.isConfigured(),
      error: 'Test failed',
      details: error.message
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { query = 'learn javascript 2025' } = await request.json();
    
    if (!googlePSE.isConfigured()) {
      return NextResponse.json({
        error: 'Google PSE not configured'
      }, { status: 500 });
    }

    const result = await googlePSE.searchYouTube(query, { 
      num: 10,
      type: 'video' 
    });

    return NextResponse.json({
      query,
      totalResults: result.totalResults,
      channelsExtracted: result.results.length,
      channels: result.results,
      quotaUsed: 1,
      quotaRemaining: 99 // Rough estimate
    });

  } catch (error) {
    return NextResponse.json({
      error: 'Search failed',
      details: error.message
    }, { status: 500 });
  }
}