import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // Fetch chunks from the chunks table with no limits
    const { data: chunks, error: chunksError } = await supabaseAdmin
      .from('chunks')
      .select('content, content_type, metadata, start_time')
      .eq('video_id', videoId)
      .order('start_time', { ascending: true });

    if (chunksError) {
      console.error('Error fetching chunks:', chunksError);
      return NextResponse.json(
        { error: 'Failed to fetch video chunks' },
        { status: 500 }
      );
    }

    if (!chunks || chunks.length === 0) {
      return NextResponse.json(
        { error: 'No content found for this video' },
        { status: 404 }
      );
    }

    // Log the number of chunks and content sizes for debugging
    console.log(`Retrieved ${chunks.length} chunks for video ${videoId}`);
    const transcriptChunks = chunks.filter(chunk => chunk.content_type === 'transcript');
    console.log(`Found ${transcriptChunks.length} transcript chunks`);
    const totalTranscriptLength = transcriptChunks.reduce((sum, chunk) => sum + (chunk.content?.length || 0), 0);
    console.log(`Total transcript length: ${totalTranscriptLength} characters`);

    // Separate chunks by type
    const commentChunks = chunks.filter(chunk => 
      chunk.content_type === 'comment' || chunk.content_type === 'comment_cluster'
    );

    // Format transcript with timestamps if available
    const transcript = transcriptChunks
      .map(chunk => {
        const startTime = chunk.start_time ? formatTimestamp(chunk.start_time) : '';
        return startTime ? `[${startTime}] ${chunk.content}` : chunk.content;
      })
      .join('\n\n');

    console.log(`Formatted transcript length: ${transcript.length} characters, approximately ${transcript.split(/\s+/).length} words`);

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
          
          return `### Comment Group (${commentCount} comments) ${keywordsText}\n${chunk.content}`;
        } else {
          // For individual comments
          const author = metadata.authorName || metadata.author || 'Anonymous';
          const likes = metadata.likeCount || 0;
          const date = metadata.publishedAt ? new Date(metadata.publishedAt).toLocaleDateString() : '';
          
          return `**${author}** (Likes: ${likes}${date ? `, Date: ${date}` : ''})\n${chunk.content}`;
        }
      })
      .join('\n\n');

    return NextResponse.json({
      transcript,
      comments
    });

  } catch (error) {
    console.error('Error in download-transcript:', error);
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