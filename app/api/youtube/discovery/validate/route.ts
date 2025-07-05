// API Route: Channel Validation
// Validates discovered channels and calculates relevance scores

import { NextRequest, NextResponse } from 'next/server';
import { channelValidationPipeline } from '@/lib/channel-validation-pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      channelIds = [],
      validateAll = false 
    } = body;

    let results;

    if (validateAll) {
      console.log('🔍 Validating all pending channels');
      results = await channelValidationPipeline.validatePendingChannels();
    } else if (channelIds.length > 0) {
      console.log(`🔍 Validating specific channels: ${channelIds.length}`);
      // For specific channels, we'd need to implement individual validation
      return NextResponse.json(
        { error: 'Specific channel validation not yet implemented' },
        { status: 501 }
      );
    } else {
      return NextResponse.json(
        { error: 'Either channelIds array or validateAll=true is required' },
        { status: 400 }
      );
    }

    // Get updated statistics
    const stats = await channelValidationPipeline.getValidationStats();

    return NextResponse.json({
      message: `Validated ${results.length} channels`,
      results: results.map(r => ({
        channelId: r.channelId,
        channelTitle: r.channelTitle,
        recommendation: r.recommendation,
        overallScore: r.scores.overallScore,
        reasonCodes: r.reasonCodes
      })),
      statistics: stats,
      summary: {
        total: results.length,
        approved: results.filter(r => r.recommendation === 'approve').length,
        rejected: results.filter(r => r.recommendation === 'reject').length,
        needsReview: results.filter(r => r.recommendation === 'review').length,
        averageScore: results.length > 0 ? 
          results.reduce((sum, r) => sum + r.scores.overallScore, 0) / results.length : 0
      }
    });

  } catch (error) {
    console.error('Validation error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to validate channels',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'stats';
    const limit = parseInt(url.searchParams.get('limit') || '50');

    if (type === 'stats') {
      // Get validation statistics
      const stats = await channelValidationPipeline.getValidationStats();
      
      return NextResponse.json({
        statistics: stats,
        quotaRecommendation: stats.pending > 0 ? 
          'Run validation on pending channels' : 
          'No pending channels to validate'
      });

    } else if (type === 'review') {
      // Get channels that need manual review
      const channelsForReview = await channelValidationPipeline.getChannelsForReview(limit);
      
      return NextResponse.json({
        message: `Found ${channelsForReview.length} channels needing review`,
        channels: channelsForReview.map(channel => ({
          channelId: channel.channelId,
          channelTitle: channel.channelTitle,
          overallScore: channel.scores.overallScore,
          scores: {
            networkCentrality: channel.scores.networkCentrality,
            contentRelevance: channel.scores.contentRelevance,
            engagementQuality: channel.scores.engagementQuality,
            uploadConsistency: channel.scores.uploadConsistency
          },
          reasonCodes: channel.reasonCodes,
          metadata: {
            subscriberCount: channel.metadata?.subscriberCount,
            videoCount: channel.metadata?.videoCount,
            thumbnailUrl: channel.metadata?.thumbnailUrl
          }
        }))
      });

    } else {
      return NextResponse.json(
        { error: 'Invalid type parameter. Use "stats" or "review"' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('Error getting validation data:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get validation data',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}