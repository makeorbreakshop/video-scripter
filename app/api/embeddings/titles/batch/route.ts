/**
 * API endpoint for batch title embedding generation
 * POST /api/embeddings/titles/batch
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabasePineconeSync } from '@/lib/supabase-pinecone-sync';
import { batchSyncVideosToPinecone } from '@/lib/title-embeddings';

interface BatchEmbeddingRequest {
  video_ids?: string[];
  limit?: number;
  force_refresh?: boolean;
}

interface BatchEmbeddingResponse {
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
  batch_id: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: BatchEmbeddingRequest = await request.json();
    const { video_ids, limit = 100, force_refresh = false } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    console.log('🚀 EMBEDDING BATCH STARTED');
    
    let videosToProcess;
    
    if (video_ids && video_ids.length > 0) {
      videosToProcess = await supabasePineconeSync.getVideoMetadataForPinecone(video_ids);
      console.log(`📋 Processing ${video_ids.length} specific videos`);
    } else {
      videosToProcess = await supabasePineconeSync.getUnsyncedVideos(limit);
      console.log(`📋 Processing next ${limit} unembedded videos`);
    }

    if (!videosToProcess || videosToProcess.length === 0) {
      console.log('✅ No videos to process - all videos already embedded');
      return NextResponse.json({
        processed: 0,
        successful: 0,
        failed: 0,
        errors: [],
        batch_id: `batch_${Date.now()}`,
        message: 'No videos to process',
      });
    }

    console.log(`⚡ PROCESSING ${videosToProcess.length} videos...`);

    // Convert to the format expected by batchSyncVideosToPinecone
    const videoData = videosToProcess.map(video => ({
      id: video.id, // Fixed: use 'id' not 'video_id'
      title: video.title,
      channel_id: video.channel_id,
      view_count: video.view_count,
      published_at: video.published_at,
      performance_ratio: video.performance_ratio || 1.0,
    }));

    // Process embeddings with larger batch size for speed
    const results = await batchSyncVideosToPinecone(videoData, apiKey, 50);

    // Update Supabase with sync status
    const successfulVideos = results.filter(r => r.success).map(r => r.id);
    const failedVideos = results.filter(r => !r.success);

    if (successfulVideos.length > 0) {
      await supabasePineconeSync.updateVideoEmbeddingStatus(successfulVideos, true);
    }

    const response: BatchEmbeddingResponse = {
      processed: results.length,
      successful: successfulVideos.length,
      failed: failedVideos.length,
      errors: failedVideos.map(f => f.error || 'Unknown error'),
      batch_id: `batch_${Date.now()}`,
    };

    console.log(`🎯 EMBEDDING BATCH COMPLETE: ${response.successful}/${response.processed} videos successfully embedded`);

    return NextResponse.json(response);
  } catch (error) {
    console.error('❌ Batch embedding failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to process batch embeddings',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get sync statistics
    const stats = await supabasePineconeSync.getSyncStats();
    
    return NextResponse.json({
      status: 'ready',
      stats: {
        total_videos: stats.total_videos,
        synced_videos: stats.synced_videos,
        unsynced_videos: stats.unsynced_videos,
        sync_percentage: stats.total_videos > 0 
          ? Math.round((stats.synced_videos / stats.total_videos) * 100)
          : 0,
      },
    });
  } catch (error) {
    console.error('❌ Failed to get embedding stats:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to get embedding statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}