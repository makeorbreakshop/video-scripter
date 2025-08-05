import { NextResponse } from 'next/server';
import { googlePSE } from '@/lib/google-pse-service';

export async function GET() {
  try {
    const quotaStatus = await googlePSE.getQuotaStatus();
    
    return NextResponse.json({
      success: true,
      quota: quotaStatus
    });
  } catch (error) {
    console.error('Error getting PSE quota:', error);
    return NextResponse.json(
      { error: 'Failed to get quota status' },
      { status: 500 }
    );
  }
}