import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { formatRawComments } from '@/lib/comments-service';
import { fetchAllYoutubeComments } from '@/lib/youtube-api';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { videoId, userId } = body;

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Check if this video has any comments already
    const { count, error: countError } = await supabaseAdmin
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('video_id', videoId);

    if (countError) {
      console.error('Error checking existing comments:', countError);
      return NextResponse.json(
        { error: 'Failed to check existing comments' },
        { status: 500 }
      );
    }

    let latestCommentDate = null;
    
    // If we have existing comments, get the latest comment date
    if (count && count > 0) {
      const { data: latestComment, error: latestError } = await supabaseAdmin
        .from('comments')
        .select('published_at')
        .eq('video_id', videoId)
        .order('published_at', { ascending: false })
        .limit(1);

      if (latestError) {
        console.error('Error fetching latest comment date:', latestError);
        return NextResponse.json(
          { error: 'Failed to fetch latest comment date' },
          { status: 500 }
        );
      }

      if (latestComment && latestComment.length > 0) {
        latestCommentDate = new Date(latestComment[0].published_at);
      }
    }

    // Construct the YouTube video URL
    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Fetch comments from YouTube
    // The YouTube API function should handle filtering based on latestCommentDate if provided
    const rawComments = await fetchAllYoutubeComments(youtubeUrl, latestCommentDate);

    if (!rawComments || rawComments.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No new comments found',
        refreshed: 0,
        total: count || 0
      });
    }

    // Format comments for database storage
    const formattedComments = formatRawComments(rawComments, videoId, userId);

    // Store comments using upsert (will handle duplicates)
    const BATCH_SIZE = 100;
    let totalInserted = 0;
    
    for (let i = 0; i < formattedComments.length; i += BATCH_SIZE) {
      const batch = formattedComments.slice(i, i + BATCH_SIZE);
      
      const { data, error } = await supabaseAdmin
        .from('comments')
        .upsert(batch, { 
          onConflict: 'comment_id',
          ignoreDuplicates: true
        });
      
      if (error) {
        console.error(`Error inserting comments batch ${i/BATCH_SIZE + 1}:`, error);
        // Continue with next batch instead of failing completely
      } else {
        // Count inserted comments (this is approximate since we're using ignoreDuplicates)
        totalInserted += batch.length;
      }
    }

    // Get the new total count
    const { count: newCount, error: newCountError } = await supabaseAdmin
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('video_id', videoId);

    if (newCountError) {
      console.error('Error getting updated comment count:', newCountError);
    }

    // Update the video's comment_count field with the new count
    if (newCount !== undefined) {
      const { error: updateError } = await supabaseAdmin
        .from('videos')
        .update({ comment_count: newCount })
        .eq('id', videoId);
      
      if (updateError) {
        console.error('Error updating video comment count:', updateError);
      } else {
        console.log(`Updated comment count for video ${videoId} to ${newCount} comments`);
      }
    }

    // Return success response
    return NextResponse.json({
      success: true,
      message: count ? 'Comments refreshed successfully' : 'Initial comments imported successfully',
      refreshed: formattedComments.length,
      previousCount: count || 0,
      newCount: newCount || 0,
      total: newCount || formattedComments.length
    });

  } catch (error) {
    console.error('Error in refresh comments:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 