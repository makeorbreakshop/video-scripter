import { NextResponse } from 'next/server';
import { googlePSE } from '@/lib/google-pse-service';

export async function GET() {
  try {
    const quotaStatus = googlePSE.getQuotaStatus();
    
    return NextResponse.json({
      success: true,
      quota: quotaStatus,
      warning: quotaStatus.remaining < 10 ? 'Low quota remaining!' : null
    });
  } catch (error) {
    console.error('Error getting PSE quota status:', error);
    return NextResponse.json(
      { error: 'Failed to get quota status' },
      { status: 500 }
    );
  }
}