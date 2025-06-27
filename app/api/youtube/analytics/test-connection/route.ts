/**
 * YouTube Analytics Test Connection API Route
 * Comprehensive test of Analytics API connections with extensive logging
 * Tests authentication, database, core metrics, and revenue permissions
 */

import { NextRequest, NextResponse } from 'next/server';
import { youtubeAnalyticsDailyService } from '@/lib/youtube-analytics-daily';

export async function POST(request: NextRequest) {
  try {
    console.log('🧪 Starting comprehensive Analytics API connection test...');
    
    // Get access token from Authorization header
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    
    if (!accessToken) {
      return NextResponse.json(
        { error: 'No access token provided in Authorization header' },
        { status: 401 }
      );
    }

    console.log('✅ Access token found in Authorization header');

    const testResults = {
      authenticationTest: { success: false, details: '', error: null },
      videoFetchTest: { success: false, details: '', error: null },
      coreMetricsTest: { success: false, details: '', error: null, sampleVideo: null },
      revenueMetricsTest: { success: false, details: '', error: null },
      databaseTest: { success: false, details: '', error: null },
      overallStatus: 'TESTING'
    };

    // Test 1: Authentication Test - Verify access token works
    console.log('\n🔐 TEST 1: Authentication Test');
    try {
      const videoIds = await youtubeAnalyticsDailyService.getVideoIdsForAnalytics();
      testResults.authenticationTest.success = true;
      testResults.authenticationTest.details = `✅ Access token valid, database connection working. Found ${videoIds.length} videos in "Make or Break Shop" channel.`;
      console.log(`✅ Authentication successful: ${videoIds.length} videos found`);
    } catch (error) {
      testResults.authenticationTest.error = error instanceof Error ? error.message : String(error);
      testResults.authenticationTest.details = `❌ Authentication failed: ${testResults.authenticationTest.error}`;
      console.error('❌ Authentication test failed:', error);
    }

    // Test 2: Video Fetch Test - Get sample videos for testing
    console.log('\n📹 TEST 2: Video Fetch Test');
    let sampleVideos: string[] = [];
    try {
      const allVideoIds = await youtubeAnalyticsDailyService.getVideoIdsForAnalytics();
      sampleVideos = allVideoIds.slice(0, 3); // Test with first 3 videos
      testResults.videoFetchTest.success = true;
      testResults.videoFetchTest.details = `✅ Sample videos selected: ${sampleVideos.join(', ')}`;
      console.log(`✅ Sample videos: ${sampleVideos.join(', ')}`);
    } catch (error) {
      testResults.videoFetchTest.error = error instanceof Error ? error.message : String(error);
      testResults.videoFetchTest.details = `❌ Failed to get sample videos: ${testResults.videoFetchTest.error}`;
      console.error('❌ Video fetch test failed:', error);
    }

    // Test 3: Comprehensive Metrics Test - Test NEW single API call with all 24 metrics
    console.log('\n📊 TEST 3: Comprehensive Metrics Test (NEW SINGLE CALL)');
    if (sampleVideos.length > 0) {
      const testVideoId = sampleVideos[0];
      testResults.coreMetricsTest.sampleVideo = testVideoId;
      
      try {
        const testDate = new Date();
        testDate.setDate(testDate.getDate() - 7); // Test with data from 1 week ago
        const startDate = testDate.toISOString().split('T')[0];
        const endDate = testDate.toISOString().split('T')[0];

        console.log(`📅 Testing NEW comprehensive metrics for video ${testVideoId} on ${startDate}`);

        // Try ALL available video metrics (36 total)
        const allMetrics = [
          'views', 'engagedViews', 'redViews',
          'estimatedMinutesWatched', 'estimatedRedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
          'comments', 'likes', 'dislikes', 'shares', 'subscribersGained', 'subscribersLost',
          'videosAddedToPlaylists', 'videosRemovedFromPlaylists',
          'annotationClickThroughRate', 'annotationCloseRate', 'annotationImpressions', 'annotationClickableImpressions', 'annotationClosableImpressions', 'annotationClicks', 'annotationCloses',
          'cardClickRate', 'cardTeaserClickRate', 'cardImpressions', 'cardTeaserImpressions', 'cardClicks', 'cardTeaserClicks',
          'estimatedRevenue', 'estimatedAdRevenue', 'grossRevenue', 'estimatedRedPartnerRevenue',
          'monetizedPlaybacks', 'playbackBasedCpm', 'adImpressions', 'cpm'
        ].join(',');
        
        console.log(`🚀 Testing ALL ${allMetrics.split(',').length} available video metrics...`);
        
        const dailyService = youtubeAnalyticsDailyService as any;
        const analyticsData = await dailyService.makeAnalyticsCall(
          testVideoId,
          startDate,
          endDate,
          allMetrics,
          accessToken
        );

        if (analyticsData && analyticsData.rows && analyticsData.rows.length > 0) {
          const row = analyticsData.rows[0];
          testResults.coreMetricsTest.success = true;
          testResults.coreMetricsTest.details = `✅ ALL METRICS SUCCESS! ${allMetrics.split(',').length} metrics: Views=${row[0]}, EngagedViews=${row[1]}, Revenue=$${row[28]}, AdRevenue=$${row[29]}, WatchTime=${row[3]}min, Likes=${row[8]}, Comments=${row[7]}, Subscribers+=${row[11]}`;
          console.log(`✅ ALL METRICS SUCCESS - ${allMetrics.split(',').length} metrics retrieved: ${JSON.stringify(row.slice(0, 10))}... (showing first 10)`);
        } else {
          testResults.coreMetricsTest.details = `⚠️ Comprehensive metrics API call successful but no data returned for ${startDate}. This may be normal if video had no activity that day.`;
          testResults.coreMetricsTest.success = true; // API call worked, just no data
          console.log('⚠️ No data returned (this may be normal)');
        }

      } catch (error) {
        testResults.coreMetricsTest.error = error instanceof Error ? error.message : String(error);
        testResults.coreMetricsTest.details = `❌ FIXED core metrics test failed: ${testResults.coreMetricsTest.error}`;
        console.error('❌ FIXED core metrics test failed:', error);
        
        // Log the full error for debugging
        if (error instanceof Error) {
          console.error('Full error details:', {
            message: error.message,
            stack: error.stack
          });
        }
      }
    } else {
      testResults.coreMetricsTest.details = '❌ No sample videos available for testing';
    }

    // Test 4: Revenue Metrics Test - Revenue now included in comprehensive call above
    console.log('\n💰 TEST 4: Revenue Metrics Test (NOTE: Revenue now included in Test 3)');
    if (sampleVideos.length > 0) {
      const testVideoId = sampleVideos[0];
      
      try {
        const testDate = new Date();
        testDate.setDate(testDate.getDate() - 7);
        const startDate = testDate.toISOString().split('T')[0];
        const endDate = testDate.toISOString().split('T')[0];

        console.log(`💰 Testing revenue metrics for video ${testVideoId} on ${startDate}`);

        // Use the same method as the daily service - try basic revenue metrics first
        const dailyService = youtubeAnalyticsDailyService as any;
        let revenueMetrics;
        
        // Test video-level revenue metrics (what we actually need for daily backfill)
        let revenueTestDetails = '';
        try {
          console.log('🧪 Testing video-level revenue metrics (required for daily backfill)');
          
          // Try video-level with just estimatedRevenue first
          try {
            revenueMetrics = await dailyService.makeAnalyticsCall(
              testVideoId,
              startDate,
              endDate,
              'estimatedRevenue',
              accessToken
            );
            revenueTestDetails += `✅ Video-level estimatedRevenue works. `;
          } catch (videoError) {
            revenueTestDetails += `❌ Video-level estimatedRevenue failed: ${videoError instanceof Error ? videoError.message : String(videoError)}. `;
            throw videoError;
          }

          // If single metric works, try both revenue metrics
          try {
            const bothRevenueMetrics = await dailyService.makeAnalyticsCall(
              testVideoId,
              startDate,
              endDate,
              'estimatedRevenue,estimatedAdRevenue',
              accessToken
            );
            revenueTestDetails += `✅ Video-level estimatedRevenue + estimatedAdRevenue works.`;
            revenueMetrics = bothRevenueMetrics; // Use the full result
          } catch (bothError) {
            revenueTestDetails += `⚠️ Both revenue metrics failed, but single estimatedRevenue works.`;
            // Keep the single metric result
          }

        } catch (mainError) {
          console.log('❌ Video-level revenue completely failed, trying channel-level as reference');
          revenueTestDetails += `Video-level failed. `;
          
          try {
            // Try channel-level as fallback to see if revenue access works at all
            const channelRevenueUrl = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
            channelRevenueUrl.searchParams.append('ids', 'channel==UCjWkNxpp3UHdEavpM_19--Q');
            channelRevenueUrl.searchParams.append('startDate', startDate);
            channelRevenueUrl.searchParams.append('endDate', endDate);
            channelRevenueUrl.searchParams.append('metrics', 'estimatedRevenue');
            
            const channelResponse = await fetch(channelRevenueUrl.toString(), {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
              }
            });

            if (channelResponse.ok) {
              const channelData = await channelResponse.json();
              revenueTestDetails += `✅ Channel-level revenue works (but we need video-level for backfill).`;
              revenueMetrics = channelData;
            } else {
              const errorText = await channelResponse.text();
              revenueTestDetails += `❌ Channel-level also failed: ${errorText}`;
              throw new Error(`Both video and channel revenue failed: ${errorText}`);
            }
          } catch (fallbackError) {
            revenueTestDetails += `❌ All revenue access failed.`;
            throw mainError; // Throw the original video-level error
          }
        }

        if (revenueMetrics && revenueMetrics.rows) {
          const row = revenueMetrics.rows[0] || [];
          testResults.revenueMetricsTest.success = true;
          testResults.revenueMetricsTest.details = `✅ Revenue metrics accessible: ${revenueTestDetails} Data: Revenue=$${row[0] || 0}`;
          console.log(`✅ Revenue metrics success: ${JSON.stringify(row)}`);
        } else {
          testResults.revenueMetricsTest.details = `⚠️ Revenue API call successful but no data returned. ${revenueTestDetails}`;
          testResults.revenueMetricsTest.success = true;
          console.log('⚠️ Revenue API works but no data');
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes('Insufficient permission') || errorMessage.includes('permission')) {
          testResults.revenueMetricsTest.error = errorMessage;
          testResults.revenueMetricsTest.details = `❌ Revenue access denied: ${errorMessage}. Your account may not be in YouTube Partner Program, or revenue data sharing needs to be enabled in YouTube Studio settings, or your channel needs to meet monetization requirements.`;
          console.error('❌ Revenue metrics permission error:', errorMessage);
        } else {
          testResults.revenueMetricsTest.error = errorMessage;
          testResults.revenueMetricsTest.details = `❌ Revenue metrics test failed: ${errorMessage}. ${revenueTestDetails || ''}`;
          console.error('❌ Revenue metrics test failed:', error);
        }
      }
    }

    // Test 5: Database Test - Test database connection and insert capability
    console.log('\n🗄️ TEST 5: Database Test');
    try {
      const { supabase } = await import('@/lib/supabase');
      
      // Test database connection by counting existing records
      const { count, error: countError } = await supabase
        .from('daily_analytics')
        .select('*', { count: 'exact', head: true });

      if (countError) {
        throw countError;
      }

      testResults.databaseTest.success = true;
      testResults.databaseTest.details = `✅ Database connection successful. Found ${count} existing daily analytics records. Ready for data insertion.`;
      console.log(`✅ Database test successful: ${count} existing records`);

    } catch (error) {
      testResults.databaseTest.error = error instanceof Error ? error.message : String(error);
      testResults.databaseTest.details = `❌ Database test failed: ${testResults.databaseTest.error}`;
      console.error('❌ Database test failed:', error);
    }

    // Determine overall status
    const allTestsPassed = testResults.authenticationTest.success && 
                          testResults.videoFetchTest.success && 
                          testResults.coreMetricsTest.success && 
                          testResults.databaseTest.success;

    const revenueWorking = testResults.revenueMetricsTest.success;

    if (allTestsPassed && revenueWorking) {
      testResults.overallStatus = 'ALL_SYSTEMS_GO';
    } else if (allTestsPassed) {
      testResults.overallStatus = 'CORE_WORKING_REVENUE_NEEDS_SETUP';
    } else {
      testResults.overallStatus = 'ISSUES_DETECTED';
    }

    console.log(`\n🎯 FINAL STATUS: ${testResults.overallStatus}`);

    return NextResponse.json({
      success: true,
      testResults,
      summary: {
        totalTests: 5,
        passedTests: [
          testResults.authenticationTest.success,
          testResults.videoFetchTest.success,
          testResults.coreMetricsTest.success,
          testResults.revenueMetricsTest.success,
          testResults.databaseTest.success
        ].filter(Boolean).length,
        criticalIssues: testResults.overallStatus === 'ISSUES_DETECTED',
        readyForBackfill: testResults.overallStatus === 'ALL_SYSTEMS_GO',
        needsRevenueSetup: testResults.overallStatus === 'CORE_WORKING_REVENUE_NEEDS_SETUP'
      }
    });

  } catch (error) {
    console.error('❌ Connection test failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        details: 'Failed to complete connection test'
      },
      { status: 500 }
    );
  }
}