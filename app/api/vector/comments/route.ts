import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface CommentCluster {
  content: string;
  metadata?: {
    keywords?: string[];
    commentCount?: number;
    authorCount?: number;
  };
}

interface Comment {
  id: string;
  text: string;
  author: string;
  cluster?: {
    keywords: string[];
    commentCount: number;
    authorCount: number;
  };
}

export async function GET(request: Request) {
  try {
    // Get videoId from query params
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');
    const limit = Number(searchParams.get('limit')) || 100; // Default to 100 comments

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId parameter' }, { status: 400 });
    }

    // Get comment clusters from the database
    const { data, error } = await supabaseAdmin
      .from('chunks')
      .select('content, metadata')
      .eq('video_id', videoId)
      .eq('content_type', 'comment_cluster')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('Error fetching comments:', error);
      return NextResponse.json({ error: 'Failed to fetch comments' }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ comments: [] }, { status: 200 });
    }

    // Process comment clusters
    const comments: Comment[] = [];
    
    // Process each cluster
    for (const cluster of data as CommentCluster[]) {
      // Split by newlines to get individual comments
      // Use split with regex to handle different newline patterns
      const clusterComments = cluster.content.split(/\\n\\n|\n\n|\\n|\n/);
      
      // Metadata from the cluster
      const metadata = cluster.metadata || {};
      const keywords = metadata.keywords || [];
      const clusterInfo = {
        keywords,
        commentCount: metadata.commentCount || clusterComments.length,
        authorCount: metadata.authorCount || 1
      };
      
      // Add each comment as an individual entry
      clusterComments.forEach((comment: string, index: number) => {
        const trimmedComment = comment.trim();
        if (trimmedComment) {
          comments.push({
            id: `${videoId}-${comments.length}`,
            text: trimmedComment,
            author: 'Anonymous',
            cluster: clusterInfo
          });
        }
      });
    }

    return NextResponse.json({ comments }, { status: 200 });
  } catch (error) {
    console.error('Error in comments API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 