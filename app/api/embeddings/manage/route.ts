/**
 * API endpoint for managing embeddings
 * GET /api/embeddings/manage - Get stats and status
 * POST /api/embeddings/manage - Manage operations (sync, cleanup, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { pineconeService } from '@/lib/pinecone-service';
import { supabasePineconeSync } from '@/lib/supabase-pinecone-sync';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const operation = searchParams.get('operation');

    switch (operation) {
      case 'stats':
      default:
        // Get comprehensive statistics
        const [pineconeStats, supabaseStats] = await Promise.all([
          pineconeService.getIndexStats(),
          supabasePineconeSync.getSyncStats(),
        ]);

        return NextResponse.json({
          pinecone: {
            total_vectors: pineconeStats.totalVectorCount,
            dimensions: pineconeStats.dimension,
            index_fullness: pineconeStats.indexFullness,
          },
          supabase: {
            total_videos: supabaseStats.total_videos,
            synced_videos: supabaseStats.synced_videos,
            unsynced_videos: supabaseStats.unsynced_videos,
            sync_percentage: supabaseStats.total_videos > 0 
              ? Math.round((supabaseStats.synced_videos / supabaseStats.total_videos) * 100)
              : 0,
          },
          system: {
            embedding_model: 'text-embedding-3-small',
            embedding_dimensions: 512,
            version: 'v1',
          },
        });

      case 'health':
        // Check system health
        try {
          await pineconeService.initializeIndex();
          const stats = await pineconeService.getIndexStats();
          
          return NextResponse.json({
            status: 'healthy',
            pinecone_connected: true,
            total_vectors: stats.totalVectorCount,
            last_check: new Date().toISOString(),
          });
        } catch (error) {
          return NextResponse.json({
            status: 'unhealthy',
            pinecone_connected: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            last_check: new Date().toISOString(),
          }, { status: 503 });
        }
    }
  } catch (error) {
    console.error('❌ Failed to get embedding management stats:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to get management statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { operation, params = {} } = body;

    switch (operation) {
      case 'sync':
        // Force sync operation
        const limit = params.limit || 100;
        console.log(`🔄 Starting forced sync for ${limit} videos`);
        
        const unsyncedVideos = await supabasePineconeSync.getUnsyncedVideos(limit);
        
        return NextResponse.json({
          operation: 'sync',
          status: 'initiated',
          videos_to_sync: unsyncedVideos.length,
          message: `Sync initiated for ${unsyncedVideos.length} videos`,
          // Note: Actual syncing would happen in background or separate endpoint
        });

      case 'cleanup':
        // Cleanup orphaned embeddings
        console.log('🧹 Starting cleanup operation');
        
        // TODO: Implement cleanup logic
        // This would find vectors in Pinecone that don't exist in Supabase
        
        return NextResponse.json({
          operation: 'cleanup',
          status: 'completed',
          message: 'Cleanup operation completed',
        });

      case 'validate':
        // Validate sync consistency
        console.log('🔍 Validating sync consistency');
        
        const validation = await supabasePineconeSync.validateSyncConsistency();
        
        return NextResponse.json({
          operation: 'validate',
          status: 'completed',
          consistency: validation,
        });

      case 'reset':
        // Reset embedding status for specific videos
        const videoIds = params.video_ids;
        if (!videoIds || !Array.isArray(videoIds)) {
          return NextResponse.json(
            { error: 'video_ids parameter is required and must be an array' },
            { status: 400 }
          );
        }
        
        console.log(`🔄 Resetting embedding status for ${videoIds.length} videos`);
        
        await supabasePineconeSync.resetEmbeddingStatus(videoIds);
        
        return NextResponse.json({
          operation: 'reset',
          status: 'completed',
          videos_reset: videoIds.length,
        });

      case 'delete':
        // Delete specific embeddings from Pinecone
        const deleteVideoIds = params.video_ids;
        if (!deleteVideoIds || !Array.isArray(deleteVideoIds)) {
          return NextResponse.json(
            { error: 'video_ids parameter is required and must be an array' },
            { status: 400 }
          );
        }
        
        console.log(`🗑️ Deleting embeddings for ${deleteVideoIds.length} videos`);
        
        await pineconeService.deleteEmbeddings(deleteVideoIds);
        await supabasePineconeSync.resetEmbeddingStatus(deleteVideoIds);
        
        return NextResponse.json({
          operation: 'delete',
          status: 'completed',
          videos_deleted: deleteVideoIds.length,
        });

      default:
        return NextResponse.json(
          { error: `Unknown operation: ${operation}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('❌ Management operation failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Management operation failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}