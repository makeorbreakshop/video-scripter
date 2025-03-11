import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { formatAnalysisMarkdown } from "@/app/utils/formatAnalysisMarkdown";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { videoIds } = body;

    if (!videoIds || !Array.isArray(videoIds) || videoIds.length === 0) {
      return NextResponse.json(
        { error: 'Video IDs array is required' },
        { status: 400 }
      );
    }

    // Fetch video metadata for all videos
    const { data: videos, error: videosError } = await supabaseAdmin
      .from('videos')
      .select('id, title, channel_id')
      .in('id', videoIds);

    if (videosError) {
      console.error('Error fetching videos:', videosError);
      return NextResponse.json(
        { error: 'Failed to fetch video metadata' },
        { status: 500 }
      );
    }

    if (!videos || videos.length === 0) {
      return NextResponse.json(
        { error: 'No videos found with the provided IDs' },
        { status: 404 }
      );
    }

    // Build a combined markdown file
    let combinedMarkdown = `# Batch Analysis Download - ${videos.length} Videos\n\n`;
    combinedMarkdown += `Downloaded on ${new Date().toLocaleString()}\n\n`;
    combinedMarkdown += `---\n\n`;

    // Process each video
    for (const video of videos) {
      // Fetch analysis for this video
      const { data: analysisData, error: analysisError } = await supabaseAdmin
        .from('skyscraper_analyses')
        .select('id, video_id, content_analysis, audience_analysis, content_gaps, structure_elements, engagement_techniques, value_delivery, implementation_blueprint, model_used, created_at')
        .eq('video_id', video.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (analysisError) {
        console.error(`Error fetching analysis for video ${video.id}:`, analysisError);
        // Continue with other videos instead of failing completely
        combinedMarkdown += `## ${video.title}\n\nError retrieving analysis for this video.\n\n---\n\n`;
        continue;
      }

      if (!analysisData || analysisData.length === 0) {
        combinedMarkdown += `## ${video.title}\n\nNo analysis found for this video.\n\n---\n\n`;
        continue;
      }

      const analysis = analysisData[0];
      
      // Add video section header
      combinedMarkdown += `## ${video.title}\n\n`;
      combinedMarkdown += `Channel: ${video.channel_id || 'Unknown Channel'}\n\n`;
      combinedMarkdown += `Video ID: [${video.id}](https://www.youtube.com/watch?v=${video.id})\n\n`;
      combinedMarkdown += `Analyzed on: ${new Date(analysis.created_at).toLocaleString()}\n\n`;
      combinedMarkdown += `Model: ${analysis.model_used || 'Unknown'}\n\n`;

      try {
        // Combine all analysis parts into one object
        const combinedAnalysis = {
          content_analysis: analysis.content_analysis || {},
          audience_analysis: analysis.audience_analysis || {},
          content_gaps: analysis.content_gaps || {},
          structure_elements: analysis.structure_elements || {}, // Note: already using structure_elements
          engagement_techniques: analysis.engagement_techniques || {},
          value_delivery: analysis.value_delivery || {},
          implementation_blueprint: analysis.implementation_blueprint || {},
          created_at: analysis.created_at,
          model_used: analysis.model_used
        };

        // Create video data object in the expected format
        const videoData = {
          title: video.title || 'Untitled Video',
          channelTitle: video.channel_id || 'Unknown Channel'
        };

        // Format the combined analysis as markdown
        const formattedAnalysis = formatAnalysisMarkdown(videoData, combinedAnalysis);
        combinedMarkdown += `${formattedAnalysis}\n\n`;
      } catch (error) {
        console.error(`Error formatting analysis for video ${video.id}:`, error);
        combinedMarkdown += `Error formatting analysis for this video: ${error instanceof Error ? error.message : 'Unknown error'}\n\n`;
      }

      // Add separator between videos
      combinedMarkdown += `---\n\n`;
    }

    return NextResponse.json({
      content: combinedMarkdown
    });

  } catch (error) {
    console.error('Error in batch-download:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 