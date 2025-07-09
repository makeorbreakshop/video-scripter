/**
 * Unified Video Import API Endpoint
 * Single endpoint for all video import operations
 * Handles competitor analysis, discovery, RSS, owner channel, and sync imports
 */

import { NextRequest, NextResponse } from 'next/server';
import { videoImportService, VideoImportRequest } from '../../../../lib/unified-video-import';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Check if this should use the queue system
    const useQueue = body.useQueue !== false; // Default to using queue
    
    // Validate request body
    const validationResult = validateRequest(body);
    if (!validationResult.valid) {
      return NextResponse.json(
        { error: validationResult.error },
        { status: 400 }
      );
    }

    const importRequest: VideoImportRequest = body;
    
    if (useQueue) {
      console.log(`🔄 Creating background job for ${importRequest.source} import`);
      console.log(`📊 Input: ${importRequest.channelIds?.length || 0} channels, ${importRequest.videoIds?.length || 0} videos`);
      console.log(`⏳ Processing will continue in worker...`);
    } else {
      console.log(`⚡ Processing ${importRequest.source} import immediately (synchronous mode)`);
      console.log(`📊 Input: ${importRequest.channelIds?.length || 0} channels, ${importRequest.videoIds?.length || 0} videos`);
      if (importRequest.options?.excludeShorts) {
        console.log(`🎬 Will exclude YouTube Shorts`);
      }
    }

    // Apply rate limiting based on request size
    const totalItems = (importRequest.videoIds?.length || 0) + 
                      (importRequest.channelIds?.length || 0) + 
                      (importRequest.rssFeedUrls?.length || 0);
    
    if (totalItems > 1000) {
      return NextResponse.json(
        { error: 'Request too large. Maximum 1000 items per request.' },
        { status: 413 }
      );
    }

    if (useQueue) {
      // Use asynchronous queue system
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      // Generate descriptive job name
      let jobDisplayName = 'unified_import';
      const jobMetadata: Record<string, unknown> = { ...importRequest };
      
      if (importRequest.source === 'competitor' && importRequest.channelIds?.length > 0) {
        // For competitor imports, try to get channel name
        try {
          const channelResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${importRequest.channelIds[0]}&key=${process.env.YOUTUBE_API_KEY}`
          );
          if (channelResponse.ok) {
            const channelData = await channelResponse.json();
            if (channelData.items?.[0]?.snippet?.title) {
              const channelName = channelData.items[0].snippet.title;
              const videoCount = channelData.items[0]?.statistics?.videoCount;
              jobDisplayName = videoCount 
                ? `Channel: ${channelName} (${parseInt(videoCount).toLocaleString()} videos)`
                : `Channel: ${channelName}`;
              jobMetadata.channel_name = channelName;
              jobMetadata.total_videos = videoCount ? parseInt(videoCount) : null;
            }
          }
        } catch (error) {
          console.error('Error fetching channel name:', error);
          jobDisplayName = `Channel: ${importRequest.channelIds[0].substring(0, 8)}...`;
        }
      } else if (importRequest.source === 'discovery') {
        jobDisplayName = `Discovery Import`;
      } else if (importRequest.source === 'sync') {
        jobDisplayName = `Channel Sync`;
      } else if (importRequest.source === 'rss') {
        jobDisplayName = `RSS Import`;
      } else if (importRequest.videoIds?.length === 1) {
        // For single video, try to get video title
        try {
          const videoResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${importRequest.videoIds[0]}&key=${process.env.YOUTUBE_API_KEY}`
          );
          if (videoResponse.ok) {
            const videoData = await videoResponse.json();
            if (videoData.items?.[0]?.snippet?.title) {
              const videoTitle = videoData.items[0].snippet.title;
              jobDisplayName = videoTitle.length > 40 
                ? `Video: ${videoTitle.substring(0, 40)}...`
                : `Video: ${videoTitle}`;
              jobMetadata.video_title = videoTitle;
            } else {
              jobDisplayName = `Video: ${importRequest.videoIds[0]}`;
            }
          }
        } catch (error) {
          console.error('Error fetching video title:', error);
          jobDisplayName = `Video: ${importRequest.videoIds[0]}`;
        }
      } else if (importRequest.videoIds?.length > 1) {
        jobDisplayName = `Batch: ${importRequest.videoIds.length} videos`;
      }

      // Create job in queue using existing schema
      const { data: job, error: jobError } = await supabase
        .from('video_processing_jobs')
        .insert({
          video_id: jobDisplayName,
          source: importRequest.source,
          status: 'pending',
          metadata: jobMetadata,
          priority: importRequest.source === 'owner' ? 1 : 2, // Owner videos get higher priority
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (jobError) {
        console.error('❌ Failed to create job:', jobError);
        return NextResponse.json(
          { error: 'Failed to create processing job' },
          { status: 500 }
        );
      }

      console.log(`✅ Created job ${job.id} for ${importRequest.source} import`);

      // Return immediate response with job ID
      return NextResponse.json({
        success: true,
        message: `Job ${job.id} created for ${importRequest.source} import`,
        jobId: job.id,
        status: 'queued',
        estimatedItems: totalItems,
        timestamp: new Date().toISOString(),
        statusUrl: `/api/video-import/job-status/${job.id}`
      });

    } else {
      // Use synchronous processing (legacy mode)
      const startTime = Date.now();
      const result = await videoImportService.processVideos(importRequest);
      const processingTime = Date.now() - startTime;

      // Log results
      console.log(`✅ Unified import completed in ${processingTime}ms`);
      console.log(`📊 Results:`, {
        success: result.success,
        videosProcessed: result.videosProcessed,
        embeddingsGenerated: result.embeddingsGenerated,
        exportFiles: result.exportFiles.length,
        errors: result.errors.length
      });

      // Return response with processing metrics
      return NextResponse.json({
        ...result,
        processingTime,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('❌ Unified video import error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred',
        videosProcessed: 0,
        embeddingsGenerated: { titles: 0, thumbnails: 0 },
        exportFiles: [],
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        processedVideoIds: []
      },
      { status: 500 }
    );
  }
}

/**
 * Handle GET requests for endpoint documentation
 */
export async function GET(request: NextRequest) {
  const documentation = {
    endpoint: '/api/video-import/unified',
    description: 'Unified video import endpoint that handles all video processing operations',
    methods: ['POST'],
    requestBody: {
      source: {
        type: 'string',
        required: true,
        enum: ['competitor', 'discovery', 'rss', 'owner', 'sync'],
        description: 'Source type of the video import'
      },
      videoIds: {
        type: 'array',
        required: false,
        description: 'Array of YouTube video IDs to import'
      },
      channelIds: {
        type: 'array',
        required: false,
        description: 'Array of YouTube channel IDs to import videos from'
      },
      rssFeedUrls: {
        type: 'array',
        required: false,
        description: 'Array of RSS feed URLs to import videos from'
      },
      options: {
        type: 'object',
        required: false,
        properties: {
          skipEmbeddings: {
            type: 'boolean',
            description: 'Skip all embedding generation'
          },
          skipExports: {
            type: 'boolean',
            description: 'Skip local export generation'
          },
          skipThumbnailEmbeddings: {
            type: 'boolean',
            description: 'Skip thumbnail embedding generation'
          },
          skipTitleEmbeddings: {
            type: 'boolean',
            description: 'Skip title embedding generation'
          },
          batchSize: {
            type: 'number',
            description: 'Batch size for processing (default: 50)'
          },
          forceReEmbed: {
            type: 'boolean',
            description: 'Force re-generation of embeddings'
          }
        }
      }
    },
    response: {
      success: {
        type: 'boolean',
        description: 'Whether the import was successful'
      },
      message: {
        type: 'string',
        description: 'Human-readable result message'
      },
      videosProcessed: {
        type: 'number',
        description: 'Number of videos successfully processed'
      },
      embeddingsGenerated: {
        type: 'object',
        properties: {
          titles: { type: 'number' },
          thumbnails: { type: 'number' }
        }
      },
      exportFiles: {
        type: 'array',
        description: 'Paths to generated export files'
      },
      errors: {
        type: 'array',
        description: 'Array of error messages'
      },
      processedVideoIds: {
        type: 'array',
        description: 'Array of successfully processed video IDs'
      },
      processingTime: {
        type: 'number',
        description: 'Processing time in milliseconds'
      },
      timestamp: {
        type: 'string',
        description: 'ISO timestamp of the request'
      }
    },
    examples: {
      competitorImport: {
        source: 'competitor',
        channelIds: ['UC6107grRI4m0o2-emgoDnAA'],
        options: {
          batchSize: 50
        }
      },
      rssImport: {
        source: 'rss',
        rssFeedUrls: ['https://www.youtube.com/feeds/videos.xml?channel_id=UC6107grRI4m0o2-emgoDnAA'],
        options: {
          skipThumbnailEmbeddings: true
        }
      },
      directVideoImport: {
        source: 'discovery',
        videoIds: ['dQw4w9WgXcQ', 'jNQXAC9IVRw'],
        options: {
          forceReEmbed: true
        }
      }
    },
    rateLimits: {
      maxItemsPerRequest: 1000,
      description: 'Maximum combined items (videoIds + channelIds + rssFeedUrls) per request'
    }
  };

  return NextResponse.json(documentation, { status: 200 });
}

/**
 * Validate the import request
 */
function validateRequest(body: any): { valid: boolean; error?: string } {
  // Check if body exists
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }

  // Check required source field
  if (!body.source) {
    return { valid: false, error: 'Source field is required' };
  }

  // Validate source value
  const validSources = ['competitor', 'discovery', 'rss', 'owner', 'sync'];
  if (!validSources.includes(body.source)) {
    return { valid: false, error: `Source must be one of: ${validSources.join(', ')}` };
  }

  // Check that at least one input is provided
  const hasVideoIds = body.videoIds && Array.isArray(body.videoIds) && body.videoIds.length > 0;
  const hasChannelIds = body.channelIds && Array.isArray(body.channelIds) && body.channelIds.length > 0;
  const hasRssUrls = body.rssFeedUrls && Array.isArray(body.rssFeedUrls) && body.rssFeedUrls.length > 0;

  if (!hasVideoIds && !hasChannelIds && !hasRssUrls) {
    return { valid: false, error: 'At least one of videoIds, channelIds, or rssFeedUrls must be provided' };
  }

  // Validate array types
  if (body.videoIds && !Array.isArray(body.videoIds)) {
    return { valid: false, error: 'videoIds must be an array' };
  }

  if (body.channelIds && !Array.isArray(body.channelIds)) {
    return { valid: false, error: 'channelIds must be an array' };
  }

  if (body.rssFeedUrls && !Array.isArray(body.rssFeedUrls)) {
    return { valid: false, error: 'rssFeedUrls must be an array' };
  }

  // Validate options if provided
  if (body.options && typeof body.options !== 'object') {
    return { valid: false, error: 'options must be an object' };
  }

  // Validate batch size
  if (body.options?.batchSize && (typeof body.options.batchSize !== 'number' || body.options.batchSize <= 0)) {
    return { valid: false, error: 'batchSize must be a positive number' };
  }

  // Validate video IDs format (basic YouTube ID validation)
  if (body.videoIds) {
    for (const videoId of body.videoIds) {
      if (typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return { valid: false, error: `Invalid video ID format: ${videoId}` };
      }
    }
  }

  // Validate channel IDs format (basic YouTube channel ID validation)
  if (body.channelIds) {
    for (const channelId of body.channelIds) {
      if (typeof channelId !== 'string' || !/^UC[a-zA-Z0-9_-]{22}$/.test(channelId)) {
        return { valid: false, error: `Invalid channel ID format: ${channelId}` };
      }
    }
  }

  // Validate RSS URLs format (allow both URLs and channel IDs)
  if (body.rssFeedUrls) {
    for (const url of body.rssFeedUrls) {
      if (typeof url !== 'string') {
        return { valid: false, error: `Invalid RSS URL format: ${url}` };
      }
      // Allow both HTTP URLs and channel IDs
      const isHttpUrl = url.startsWith('http');
      const isChannelId = url.startsWith('UC') && url.length === 24;
      if (!isHttpUrl && !isChannelId) {
        return { valid: false, error: `Invalid RSS URL format: ${url}. Must be HTTP URL or channel ID starting with UC` };
      }
    }
  }

  return { valid: true };
}

/**
 * Handle OPTIONS requests for CORS
 */
export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}