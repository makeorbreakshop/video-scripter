import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { videoIds, includeTranscript = true, includeComments = true } = body;

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
    let combinedMarkdown = `# Batch Download - ${videos.length} Videos\n\n`;
    combinedMarkdown += `Downloaded on ${new Date().toLocaleString()}\n\n`;
    combinedMarkdown += `---\n\n`;

    // Process each video
    for (const video of videos) {
      // Fetch chunks for this video
      const { data: chunks, error: chunksError } = await supabaseAdmin
        .from('chunks')
        .select('content, content_type, metadata, start_time')
        .eq('video_id', video.id)
        .order('start_time', { ascending: true });

      if (chunksError) {
        console.error(`Error fetching chunks for video ${video.id}:`, chunksError);
        // Continue with other videos instead of failing completely
        combinedMarkdown += `## ${video.title}\n\nError retrieving content for this video.\n\n---\n\n`;
        continue;
      }

      if (!chunks || chunks.length === 0) {
        combinedMarkdown += `## ${video.title}\n\nNo content found for this video.\n\n---\n\n`;
        continue;
      }

      // Add video section header
      combinedMarkdown += `## ${video.title}\n\n`;
      combinedMarkdown += `Channel: ${video.channel_id || 'Unknown Channel'}\n\n`;
      combinedMarkdown += `Video ID: [${video.id}](https://www.youtube.com/watch?v=${video.id})\n\n`;

      // Separate chunks by type
      const transcriptChunks = chunks.filter(chunk => chunk.content_type === 'transcript');
      const commentChunks = chunks.filter(chunk => 
        chunk.content_type === 'comment' || chunk.content_type === 'comment_cluster'
      );

      // Calculate word counts for feedback
      const transcriptWordCount = transcriptChunks.reduce((sum, chunk) => {
        return sum + (chunk.content ? chunk.content.split(/\s+/).length : 0);
      }, 0);
      
      const commentsWordCount = commentChunks.reduce((sum, chunk) => {
        return sum + (chunk.content ? chunk.content.split(/\s+/).length : 0);
      }, 0);

      // Add transcript if requested
      if (includeTranscript && transcriptChunks.length > 0) {
        // Format transcript with timestamps if available
        const transcript = transcriptChunks
          .map(chunk => {
            const startTime = chunk.start_time ? formatTimestamp(chunk.start_time) : '';
            return startTime ? `[${startTime}] ${chunk.content}` : chunk.content;
          })
          .join('\n\n');

        combinedMarkdown += `### Transcript (${transcriptWordCount.toLocaleString()} words)\n\n${transcript}\n\n`;
      }

      // Add comments if requested
      if (includeComments && commentChunks.length > 0) {
        // Check if the comments contain comment clusters
        const hasCommentClusters = commentChunks.some(chunk => chunk.content_type === 'comment_cluster');
        
        if (hasCommentClusters) {
          combinedMarkdown += `### Comment Groups (Semantically Clustered, ${commentsWordCount.toLocaleString()} words)\n\n`;
          combinedMarkdown += `*These comments have been semantically grouped using OpenAI embeddings*\n\n`;
        } else {
          combinedMarkdown += `### Comments (${commentsWordCount.toLocaleString()} words)\n\n`;
        }
        
        // Format comments with metadata
        const comments = commentChunks
          .map(chunk => {
            const metadata = chunk.metadata || {};
            
            // Handle different formats based on content type
            if (chunk.content_type === 'comment_cluster') {
              // For comment clusters, include cluster information
              const commentCount = metadata.commentCount || 0;
              const keywords = metadata.keywords || [];
              const keywordsText = keywords.length > 0 ? `Keywords: ${keywords.join(', ')}` : '';
              
              return `#### Comment Group (${commentCount} comments) ${keywordsText}\n${chunk.content}`;
            } else {
              // For individual comments
              const author = metadata.authorName || metadata.author || 'Anonymous';
              const likes = metadata.likeCount || 0;
              const date = metadata.publishedAt ? new Date(metadata.publishedAt).toLocaleDateString() : '';
              
              return `**${author}** (Likes: ${likes}${date ? `, Date: ${date}` : ''})\n${chunk.content}`;
            }
          })
          .join('\n\n');

        combinedMarkdown += `${comments}\n\n`;
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

// Helper function to format timestamp in MM:SS format
function formatTimestamp(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '';
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
} 