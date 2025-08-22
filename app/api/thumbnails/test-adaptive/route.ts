import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { batchGenerateThumbnailEmbeddings } from '@/lib/thumbnail-embeddings';

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { videoCount = 200 } = await request.json();
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🚀 ADAPTIVE RATE LIMITER TEST - ${videoCount} videos`);
    console.log(`${'='.repeat(70)}\n`);
    
    const testStartTime = Date.now();
    
    // Create admin client

    // Get unprocessed videos
    const { data: videos, error: videosError } = await supabase
      .from('videos')
      .select('id, title, thumbnail_url, channel_id, channel_name, view_count, published_at, performance_ratio')
      .not('thumbnail_url', 'is', null)
      .or('embedding_thumbnail_synced.is.null,embedding_thumbnail_synced.eq.false')
      .order('published_at', { ascending: false })
      .limit(videoCount);

    if (videosError || !videos || videos.length === 0) {
      return NextResponse.json({
        success: false,
        error: videosError?.message || 'No videos found'
      }, { status: 500 });
    }

    // Filter valid thumbnails
    const validVideos = videos.filter(video => 
      video.thumbnail_url && 
      video.thumbnail_url.includes('ytimg.com')
    );

    console.log(`📊 Test Configuration:`);
    console.log(`   • Videos to process: ${validVideos.length}`);
    console.log(`   • Adaptive rate limiting: ENABLED`);
    console.log(`   • Target utilization: 85% of API limit`);
    console.log(`   • Max concurrency: 10 requests`);
    console.log(`   • Dynamic adjustment: YES\n`);

    // Prepare video data
    const videoProcessingData = validVideos.map(video => ({
      id: video.id,
      thumbnailUrl: video.thumbnail_url
    }));
    
    const batchStartTime = Date.now();
    let lastProgressTime = Date.now();
    let lastProcessedCount = 0;
    
    // Generate embeddings with adaptive rate limiting
    const embeddingResults = await batchGenerateThumbnailEmbeddings(
      videoProcessingData,
      50, // Smaller batch size for more frequent adjustments
      (progress) => {
        const now = Date.now();
        const timeDelta = (now - lastProgressTime) / 1000;
        const countDelta = progress.processed - lastProcessedCount;
        const instantRate = timeDelta > 0 ? countDelta / timeDelta : 0;
        
        const elapsed = (now - batchStartTime) / 1000;
        const overallRate = progress.processed / elapsed;
        
        console.log(`\n📈 Progress: ${progress.processed}/${progress.total} (${Math.round(progress.processed / progress.total * 100)}%)`);
        console.log(`   • Instant rate: ${instantRate.toFixed(1)} videos/sec`);
        console.log(`   • Overall rate: ${overallRate.toFixed(1)} videos/sec`);
        console.log(`   • Success: ${progress.success} | Failed: ${progress.failed}`);
        
        lastProgressTime = now;
        lastProcessedCount = progress.processed;
      },
      true // USE ADAPTIVE RATE LIMITING
    );

    const totalTime = Date.now() - testStartTime;
    const successCount = embeddingResults.filter(r => r.success).length;
    const failCount = embeddingResults.filter(r => !r.success).length;
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🎯 ADAPTIVE RATE LIMITER TEST COMPLETE`);
    console.log(`${'='.repeat(70)}`);
    console.log(`⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s`);
    console.log(`📊 Results:`);
    console.log(`   • Processed: ${successCount}/${validVideos.length} videos`);
    console.log(`   • Failed: ${failCount} videos`);
    console.log(`   • Average rate: ${(validVideos.length / (totalTime / 1000)).toFixed(1)} videos/second`);
    console.log(`   • Cost: $${(successCount * 0.00098).toFixed(2)}`);
    console.log(`${'='.repeat(70)}\n`);

    return NextResponse.json({
      success: true,
      message: `Adaptive rate limiter test complete`,
      data: {
        processed: successCount,
        total: validVideos.length,
        failed: failCount,
        performance: {
          total_time_seconds: (totalTime / 1000).toFixed(1),
          average_rate: (validVideos.length / (totalTime / 1000)).toFixed(1),
          videos_per_second: (validVideos.length / (totalTime / 1000)).toFixed(1)
        },
        cost: `$${(successCount * 0.00098).toFixed(2)}`
      }
    });

  } catch (error) {
    console.error('❌ Error in adaptive test:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}