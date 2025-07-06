/**
 * API endpoint to embed ALL unembedded videos in automatic batches
 * POST /api/embeddings/titles/embed-all
 * 
 * This endpoint automatically processes all unembedded videos in batches
 * until every video in the database has been embedded.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 EMBED ALL VIDEOS REQUEST STARTED');
    
    // Call the batch endpoint with "embed all" parameters
    const batchResponse = await fetch(`${request.nextUrl.origin}/api/embeddings/titles/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: 5000  // This triggers "embed all" mode
      })
    });

    if (!batchResponse.ok) {
      const error = await batchResponse.text();
      throw new Error(`Batch embedding request failed: ${error}`);
    }

    const result = await batchResponse.json();
    
    console.log(`🎯 EMBED ALL COMPLETED: ${result.successful}/${result.processed} videos embedded`);
    
    return NextResponse.json({
      success: true,
      message: `Successfully embedded ${result.successful} out of ${result.processed} videos`,
      ...result
    });

  } catch (error) {
    console.error('❌ Embed all failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}