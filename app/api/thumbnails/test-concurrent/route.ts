import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { batchGenerateThumbnailEmbeddings, exportThumbnailEmbeddings } from '@/lib/thumbnail-embeddings';
import { pineconeThumbnailService } from '@/lib/pinecone-thumbnail-service';

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { videoCount = 50, useAdaptiveRateLimit = true } = await request.json();
    
    console.log(`🚀 Starting concurrent thumbnail test with ${videoCount} most recent videos...`);
    console.log(`📊 Adaptive Rate Limiting: ${useAdaptiveRateLimit ? 'ENABLED' : 'DISABLED'}`);
    const testStartTime = Date.now();
    
    // Create admin client to bypass RLS

    // Get most recent videos that need thumbnail processing
    const { data: videos, error: videosError } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, channel_id, channel_name, view_count, published_at, performance_ratio')
      .not('thumbnail_url', 'is', null)
      .or('embedding_thumbnail_synced.is.null,embedding_thumbnail_synced.eq.false')
      .order('published_at', { ascending: false })
      .limit(videoCount);

    if (videosError) {
      console.error('❌ Failed to fetch videos:', videosError);
      return NextResponse.json({
        success: false,
        error: videosError.message
      }, { status: 500 });
    }

    if (!videos || videos.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No unprocessed videos found',
        data: { processed: 0, total: 0 }
      });
    }

    console.log(`📋 Found ${videos.length} unprocessed videos`);
    console.log(`📅 Date range: ${videos[videos.length - 1].published_at} to ${videos[0].published_at}`);
    
    // Filter out videos without valid thumbnail URLs
    const validVideos = videos.filter(video => 
      video.thumbnail_url && 
      video.thumbnail_url.includes('ytimg.com')
    );

    console.log(`📸 Processing ${validVideos.length} videos with valid thumbnails`);

    // Prepare video data for batch processing
    const videoProcessingData = validVideos.map(video => ({
      id: video.id,
      thumbnailUrl: video.thumbnail_url
    }));
    
    const batchStartTime = Date.now();
    
    // Generate embeddings using concurrent processing
    const embeddingResults = await batchGenerateThumbnailEmbeddings(
      videoProcessingData,
      75, // Keep batch size at 75
      (progress) => {
        const elapsed = Date.now() - batchStartTime;
        const rate = progress.processed / (elapsed / 1000);
        console.log(`🔄 Progress: ${progress.processed}/${progress.total} | Rate: ${rate.toFixed(1)} videos/sec | Success: ${progress.success}, Failed: ${progress.failed}`);
      },
      useAdaptiveRateLimit
    );

    // Separate successful and failed embeddings
    const successfulEmbeddings: Array<{ video: any; embedding: number[] }> = [];
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
      }
    });

    // Store successful embeddings in Pinecone
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
        console.log(`📁 Exporting ${pineconeSuccess} embeddings to local files...`);
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
      }
    }

    const totalTime = Date.now() - testStartTime;
    const averageTime = totalTime / validVideos.length;
    
    console.log(`\n🎯 CONCURRENT TEST COMPLETE`);
    console.log(`⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s`);
    console.log(`📊 Average time per video: ${averageTime.toFixed(0)}ms`);
    console.log(`🚀 Processing rate: ${(validVideos.length / (totalTime / 1000)).toFixed(1)} videos/second`);

    return NextResponse.json({
      success: true,
      message: `Processed ${pineconeSuccess} of ${validVideos.length} thumbnails`,
      data: {
        processed: pineconeSuccess,
        total: validVideos.length,
        failed: {
          embeddings: failedVideos.length,
          pinecone: pineconeFailures
        },
        performance: {
          total_time_seconds: (totalTime / 1000).toFixed(1),
          average_time_ms: averageTime.toFixed(0),
          videos_per_second: (validVideos.length / (totalTime / 1000)).toFixed(1)
        },
        cost: `$${(successfulEmbeddings.length * 0.00098).toFixed(2)}`
      }
    });

  } catch (error) {
    console.error('❌ Error in concurrent test:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}