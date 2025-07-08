import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { batchGenerateThumbnailEmbeddings, exportThumbnailEmbeddings } from '@/lib/thumbnail-embeddings';
import { pineconeThumbnailService } from '@/lib/pinecone-thumbnail-service';

interface Video2024Data {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
}

export async function GET(request: NextRequest) {
  try {
    console.log('📊 Getting 2024 thumbnail batch processing status...');
    
    // Create admin client to access videos data
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get statistics for 2024 videos
    const { data: stats, error: statsError } = await supabase
      .rpc('get_thumbnail_processing_stats');

    if (statsError) {
      console.error('❌ Failed to get processing stats:', statsError);
      return NextResponse.json({
        success: false,
        error: statsError.message
      }, { status: 500 });
    }

    // Get current Pinecone index stats
    const pineconeStats = await pineconeThumbnailService.getThumbnailIndexStats();
    
    return NextResponse.json({
      success: true,
      data: {
        database: stats[0] || {
          total_videos_with_thumbnails: 0,
          processed_thumbnails: 0,
          unprocessed_thumbnails: 0,
          videos_2024_total: 0,
          videos_2024_unprocessed: 0,
          processing_percentage: 0
        },
        pinecone: pineconeStats,
        estimated_cost: {
          total_2024_videos: stats[0]?.videos_2024_total || 0,
          cost_per_thumbnail: 0.00098,
          total_estimated_cost: ((stats[0]?.videos_2024_total || 0) * 0.00098).toFixed(2)
        }
      }
    });

  } catch (error) {
    console.error('❌ Error getting batch status:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { batchSize = 75, startOffset = 0, maxVideos } = await request.json();
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🚀 STARTING 2024-2025 THUMBNAIL BATCH PROCESSING`);
    console.log(`${'='.repeat(70)}`);
    console.log(`📦 Batch size: ${batchSize}`);
    console.log(`📍 Start offset: ${startOffset}`);
    console.log(`📊 Max videos: ${maxVideos || 'all'}`);
    console.log(`🕒 Started: ${new Date().toLocaleString()}`);
    console.log(`${'='.repeat(70)}`);
    
    // Create admin client to bypass RLS
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get 2024-2025 videos that need thumbnail processing
    let query = supabase
      .from('videos')
      .select('id, title, thumbnail_url, channel_id, channel_name, view_count, published_at, performance_ratio')
      .gte('published_at', '2024-01-01')
      .not('thumbnail_url', 'is', null)
      .or('embedding_thumbnail_synced.is.null,embedding_thumbnail_synced.eq.false')
      .order('published_at', { ascending: false });

    if (maxVideos) {
      query = query.limit(maxVideos);
    }

    if (startOffset > 0) {
      query = query.range(startOffset, startOffset + (maxVideos || 1000) - 1);
    }

    const { data: videos, error: videosError } = await query;

    if (videosError) {
      console.error('❌ Failed to fetch 2024 videos:', videosError);
      return NextResponse.json({
        success: false,
        error: videosError.message
      }, { status: 500 });
    }

    if (!videos || videos.length === 0) {
      console.log('✅ No unprocessed 2024-2025 videos found');
      return NextResponse.json({
        success: true,
        message: 'No unprocessed 2024-2025 videos found',
        data: {
          processed: 0,
          total: 0,
          cost: '$0.00',
          skipped: 0
        }
      });
    }

    console.log(`\n📋 Database Query Results:`);
    console.log(`   └── Found: ${videos.length} unprocessed 2024-2025 videos`);
    
    // Filter out videos without valid thumbnail URLs
    const validVideos = videos.filter(video => 
      video.thumbnail_url && 
      video.thumbnail_url.includes('ytimg.com')
    );

    if (validVideos.length === 0) {
      console.log('⚠️ No videos with valid thumbnails found');
      return NextResponse.json({
        success: true,
        message: 'No videos with valid thumbnails found',
        data: {
          processed: 0,
          total: videos.length,
          cost: '$0.00',
          skipped: videos.length
        }
      });
    }

    const skippedCount = videos.length - validVideos.length;
    console.log(`   └── Valid thumbnails: ${validVideos.length} videos`);
    if (skippedCount > 0) {
      console.log(`   └── Skipped: ${skippedCount} videos (invalid URLs)`);
    }
    
    console.log(`\n🔄 Starting embedding generation phase...`);

    // Prepare video data for batch processing (with caching support)
    const videoProcessingData = validVideos.map(video => ({
      id: video.id,
      thumbnailUrl: video.thumbnail_url
    }));
    
    // Generate embeddings using Replicate with caching
    const embeddingResults = await batchGenerateThumbnailEmbeddings(
      videoProcessingData,
      batchSize,
      (progress) => {
        const percent = Math.round((progress.processed / progress.total) * 100);
        const successRate = progress.processed > 0 ? Math.round((progress.success / progress.processed) * 100) : 0;
        console.log(`📈 Overall: ${progress.processed}/${progress.total} (${percent}%) | Success: ${successRate}% | Current: Batch ${progress.currentBatch}/${progress.totalBatches}`);
      }
    );

    // Separate successful and failed embeddings
    const successfulEmbeddings: Array<{ video: Video2024Data; embedding: number[] }> = [];
    const failedVideos: string[] = [];

    embeddingResults.forEach((result) => {
      if (result.success && result.embedding) {
        const video = validVideos.find(v => v.id === result.id);
        if (video) {
          successfulEmbeddings.push({
            video: video,
            embedding: result.embedding
          });
        }
      } else {
        failedVideos.push(result.id);
        console.error(`❌ Failed to generate embedding for ${result.id}:`, result.error);
      }
    });

    console.log(`\n📊 Embedding Generation Results:`);
    console.log(`   └── Success: ${successfulEmbeddings.length} embeddings`);
    console.log(`   └── Failed: ${failedVideos.length} embeddings`);

    // Store successful embeddings in Pinecone
    console.log(`\n🔄 Starting Pinecone storage phase...`);
    let pineconeSuccess = 0;
    let pineconeFailures = 0;

    if (successfulEmbeddings.length > 0) {
      const videoData = successfulEmbeddings.map(item => item.video);
      const embeddings = successfulEmbeddings.map(item => item.embedding);

      const pineconeResult = await pineconeThumbnailService.syncVideoThumbnailsToPinecone(
        videoData,
        embeddings
      );

      pineconeSuccess = pineconeResult.success;
      pineconeFailures = pineconeResult.failed;

      // Export successful embeddings to local files
      if (pineconeSuccess > 0) {
        console.log(`\n📁 Starting local export phase...`);
        try {
          const successfulVideoData = videoData.slice(0, pineconeSuccess);
          const successfulEmbeddingsData = embeddings.slice(0, pineconeSuccess);
          
          await exportThumbnailEmbeddings(successfulVideoData, successfulEmbeddingsData);
        } catch (exportError) {
          console.error('⚠️ Local export failed (processing continues):', exportError);
        }
      }
    }

    // Update database status for successfully processed videos
    const successfulVideoIds = successfulEmbeddings.slice(0, pineconeSuccess).map(item => item.video.id);
    
    if (successfulVideoIds.length > 0) {
      const { error: updateError } = await supabase
        .rpc('batch_mark_thumbnails_processed', {
          video_ids: successfulVideoIds,
          embedding_version: 'clip-vit-large-patch14'
        });

      if (updateError) {
        console.error('❌ Failed to update video status:', updateError);
        // Don't fail the whole operation, just log the error
      } else {
        console.log(`✅ Updated database status for ${successfulVideoIds.length} videos`);
      }
    }

    const totalCost = successfulEmbeddings.length * 0.00098;
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🎯 BATCH PROCESSING COMPLETE`);
    console.log(`${'='.repeat(70)}`);
    console.log(`✅ Successfully processed: ${pineconeSuccess}/${validVideos.length} thumbnails`);
    console.log(`💰 Total cost: $${totalCost.toFixed(2)}`);
    console.log(`🕒 Completed: ${new Date().toLocaleString()}`);
    console.log(`${'='.repeat(70)}`);

    return NextResponse.json({
      success: true,
      message: `Processed ${pineconeSuccess} of ${validVideos.length} thumbnails`,
      data: {
        processed: pineconeSuccess,
        total: validVideos.length,
        skipped: skippedCount,
        failed: {
          embeddings: failedVideos.length,
          pinecone: pineconeFailures
        },
        cost: `$${totalCost.toFixed(2)}`,
        embedding_generation: {
          success: successfulEmbeddings.length,
          failed: failedVideos.length
        },
        pinecone_storage: {
          success: pineconeSuccess,
          failed: pineconeFailures
        }
      }
    });

  } catch (error) {
    console.error('❌ Error in batch processing:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}