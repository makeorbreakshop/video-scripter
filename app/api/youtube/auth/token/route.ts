/**
 * YouTube API Token Endpoint
 * 
 * Provides access tokens for server-side scripts like the backfill operation.
 * This endpoint refreshes the stored OAuth token if needed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getValidAccessToken } from '@/lib/youtube-oauth';

export async function POST(request: NextRequest) {
  try {
    console.log('🔑 Token request received for server-side operation');
    
    // Get a valid access token (handles refresh if needed)
    const accessToken = await getValidAccessToken();
    
    if (!accessToken) {
      return NextResponse.json({
        success: false,
        error: 'Unable to obtain valid access token. Please re-authenticate.'
      }, { status: 401 });
    }
    
    console.log('✅ Valid access token provided');
    
    return NextResponse.json({
      success: true,
      accessToken,
      expiresIn: 3600 // Typical OAuth token expiry
    });
    
  } catch (error) {
    console.error('❌ Token endpoint error:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}

/**
 * GET endpoint to check token status
 */
export async function GET() {
  try {
    const accessToken = await getValidAccessToken();
    
    return NextResponse.json({
      success: true,
      hasValidToken: !!accessToken,
      message: accessToken ? 'Valid token available' : 'No valid token available'
    });
    
  } catch (error) {
    console.error('❌ Token status check error:', error);
    
    return NextResponse.json({
      success: false,
      hasValidToken: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}