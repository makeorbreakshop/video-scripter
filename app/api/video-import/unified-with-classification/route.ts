import { NextRequest, NextResponse } from 'next/server';
import { videoImportService } from '@/lib/unified-video-import';

/**
 * Example API endpoint demonstrating unified video import with integrated classification
 * 
 * POST /api/video-import/unified-with-classification
 * 
 * Request body:
 * {
 *   "source": "competitor",
 *   "channelIds": ["UC..."],
 *   "videoIds": ["..."],
 *   "options": {
 *     "skipClassification": false,  // Set to false to enable classification
 *     "maxVideosPerChannel": 50,
 *     "batchSize": 50
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Ensure classification is enabled
    const options = {
      ...body.options,
      skipClassification: false
    };
    
    const importRequest = {
      ...body,
      options
    };
    
    console.log('🚀 Starting unified import with classification:', {
      source: importRequest.source,
      channelCount: importRequest.channelIds?.length || 0,
      videoCount: importRequest.videoIds?.length || 0,
      skipClassification: options.skipClassification
    });
    
    const result = await videoImportService.processVideos(importRequest);
    
    return NextResponse.json({
      success: result.success,
      message: result.message,
      stats: {
        videosProcessed: result.videosProcessed,
        classificationsGenerated: result.classificationsGenerated,
        embeddingsGenerated: result.embeddingsGenerated,
        exportFiles: result.exportFiles
      },
      videoIds: result.processedVideoIds,
      errors: result.errors
    });
    
  } catch (error) {
    console.error('Import with classification failed:', error);
    return NextResponse.json(
      { 
        error: 'Import failed', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}