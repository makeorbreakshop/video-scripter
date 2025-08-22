import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { batchGenerateThumbnailEmbeddings } from '@/lib/thumbnail-embeddings';
import { pineconeThumbnailService } from '@/lib/pinecone-thumbnail-service';

interface VideoData {
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
  const supabase = getSupabase();
  try {
    console.log('📊 Getting thumbnail batch processing status for all years...');
    
    // Create admin client to access videos data

    // Get statistics for all videos since 2024
    const { data: stats, error: statsError } = await supabase
      .from('videos')
      .select('published_at, embedding_thumbnail_synced, thumbnail_url')
      .gte('published_at', '2024-01-01')
      .not('thumbnail_url', 'is', null);

    if (statsError) {
      console.error('❌ Failed to get processing stats:', statsError);
      return NextResponse.json({
        success: false,
        error: statsError.message
      }, { status: 500 });
    }

    // Calculate statistics by year
    const yearStats: Record<string, any> = {};
    let totalWithThumbnails = 0;
    let totalProcessed = 0;

    stats?.forEach(video => {
      const year = new Date(video.published_at).getFullYear().toString();
      if (!yearStats[year]) {
        yearStats[year] = {
          total: 0,
          processed: 0,
          unprocessed: 0
        };
      }
      
      yearStats[year].total++;
      totalWithThumbnails++;
      
      if (video.embedding_thumbnail_synced) {
        yearStats[year].processed++;
        totalProcessed++;
      } else {
        yearStats[year].unprocessed++;
      }
    });

    // Get current Pinecone index stats
    const pineconeStats = await pineconeThumbnailService.getThumbnailIndexStats();
    
    const totalUnprocessed = totalWithThumbnails - totalProcessed;
    
    return NextResponse.json({
      success: true,
      data: {
        summary: {
          total_videos_with_thumbnails: totalWithThumbnails,
          total_processed: totalProcessed,
          total_unprocessed: totalUnprocessed,
          processing_percentage: totalWithThumbnails > 0 ? Math.round((totalProcessed / totalWithThumbnails) * 100) : 0
        },
        by_year: yearStats,
        pinecone: pineconeStats,
        estimated_cost: {
          total_unprocessed: totalUnprocessed,
          cost_per_thumbnail: 0.00098,
          total_estimated_cost: (totalUnprocessed * 0.00098).toFixed(2)
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
  const supabase = getSupabase();
  try {
    const { 
      batchSize = 75, 
      startOffset = 0, 
      maxVideos,
      startYear = 2024,
      endYear = new Date().getFullYear()
    } = await request.json();
    
    console.log(`🚀 Starting ${startYear}-${endYear} thumbnail batch processing...`);
    console.log(`📦 Batch size: ${batchSize}, Start offset: ${startOffset}, Max videos: ${maxVideos || 'all'}`);
    
    // Create admin client to bypass RLS

    // Get videos from specified year range that need thumbnail processing
    let query = supabase
      .from('videos')
      .select('id, title, thumbnail_url, channel_id, channel_name, view_count, published_at, performance_ratio')
      .gte('published_at', `${startYear}-01-01`)
      .lt('published_at', `${endYear + 1}-01-01`)
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
      console.error('❌ Failed to fetch videos:', videosError);
      return NextResponse.json({
        success: false,
        error: videosError.message
      }, { status: 500 });
    }

    if (!videos || videos.length === 0) {
      console.log(`✅ No unprocessed ${startYear}-${endYear} videos found`);
      return NextResponse.json({
        success: true,
        message: `No unprocessed ${startYear}-${endYear} videos found`,
        data: {
          processed: 0,
          total: 0,
          cost: '$0.00',
          skipped: 0
        }
      });
    }

    console.log(`📋 Found ${videos.length} unprocessed ${startYear}-${endYear} videos`);
    
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
    console.log(`📸 Processing ${validVideos.length} videos with valid thumbnails (${skippedCount} skipped)`);

    // Group videos by year for tracking
    const videosByYear: Record<string, number> = {};
    validVideos.forEach(video => {
      const year = new Date(video.published_at).getFullYear().toString();
      videosByYear[year] = (videosByYear[year] || 0) + 1;
    });
    
    console.log('📅 Videos by year:', videosByYear);

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
        console.log(`🔄 Progress: ${progress.processed}/${progress.total} (${progress.success} success, ${progress.failed} failed)`);
      }
    );

    // Separate successful and failed embeddings
    const successfulEmbeddings: Array<{ video: VideoData; embedding: number[] }> = [];
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

    console.log(`✅ Generated ${successfulEmbeddings.length} embeddings, ${failedVideos.length} failed`);

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
    
    console.log(`🎯 BATCH COMPLETE: ${pineconeSuccess}/${validVideos.length} thumbnails processed successfully`);
    console.log(`💰 Total cost: $${totalCost.toFixed(2)}`);

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
        videos_by_year: videosByYear,
        year_range: `${startYear}-${endYear}`,
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