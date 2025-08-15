import { NextRequest, NextResponse } from 'next/server';
import { youtubeAPIWithFallback } from '@/lib/youtube-api-with-fallback';
import { quotaTracker } from '@/lib/youtube-quota-tracker';

export async function GET(request: NextRequest) {
  try {
    // Get current quota usage from tracker
    const quotaStatus = await quotaTracker.getQuotaStatus();
    
    // Get API key status
    const apiStatus = youtubeAPIWithFallback.getStatus();
    
    // Test primary key if not exhausted
    let primaryWorking = false;
    let primaryQuotaRemaining = 0;
    
    if (apiStatus.hasPrimary && !apiStatus.primaryExhausted) {
      try {
        const testUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&id=UCX6OQ3DkcsbYNE6H8uQQuVA&key=${process.env.YOUTUBE_API_KEY}`;
        const response = await fetch(testUrl);
        primaryWorking = response.ok;
        
        if (!response.ok && response.status === 403) {
          const text = await response.text();
          if (text.includes('quotaExceeded')) {
            primaryWorking = false;
          }
        }
      } catch (error) {
        primaryWorking = false;
      }
    }
    
    // Test backup key if available
    let backupWorking = false;
    let backupQuotaRemaining = 10000; // Assume full quota for new project
    
    if (apiStatus.hasBackup) {
      try {
        const testUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&id=UCX6OQ3DkcsbYNE6H8uQQuVA&key=${process.env.YOUTUBE_API_KEY_BACKUP}`;
        const response = await fetch(testUrl);
        backupWorking = response.ok;
        
        if (!response.ok && response.status === 403) {
          const text = await response.text();
          if (text.includes('quotaExceeded')) {
            backupWorking = false;
            backupQuotaRemaining = 0;
          }
        }
      } catch (error) {
        backupWorking = false;
      }
    }
    
    return NextResponse.json({
      primary: {
        configured: apiStatus.hasPrimary,
        working: primaryWorking,
        exhausted: apiStatus.primaryExhausted,
        quotaUsed: quotaStatus?.quota_used || 0,
        quotaLimit: quotaStatus?.quota_limit || 10000,
        quotaRemaining: quotaStatus?.quota_remaining || 10000
      },
      backup: {
        configured: apiStatus.hasBackup,
        working: backupWorking,
        active: apiStatus.usingBackup,
        quotaRemaining: backupQuotaRemaining
      },
      nextReset: apiStatus.nextReset,
      currentlyUsing: apiStatus.usingBackup ? 'backup' : 'primary'
    });
    
  } catch (error) {
    console.error('Error checking quota status:', error);
    return NextResponse.json(
      { error: 'Failed to check quota status' },
      { status: 500 }
    );
  }
}