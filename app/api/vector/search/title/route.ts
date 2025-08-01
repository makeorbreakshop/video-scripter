import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import { pineconeService } from '@/lib/pinecone-service';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');
    const limit = parseInt(searchParams.get('limit') || '10');

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get the source video to find its title
    const { data: sourceVideo, error: sourceError } = await supabase
      .from('videos')
      .select('id, title')
      .eq('id', videoId)
      .single();

    if (sourceError || !sourceVideo) {
      return NextResponse.json(
        { error: 'Source video not found' },
        { status: 404 }
      );
    }

    // Initialize Pinecone client to fetch the embedding
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
    
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    // Fetch the source video's embedding from Pinecone
    const fetchResponse = await index.fetch([videoId]);
    const sourceEmbedding = fetchResponse.records[videoId]?.values;
    
    if (!sourceEmbedding) {
      return NextResponse.json(
        { error: 'Source video has no title embedding in Pinecone' },
        { status: 400 }
      );
    }

    // Search for similar videos using the embedding
    const searchResult = await pineconeService.searchSimilar(
      sourceEmbedding,
      limit + 1, // +1 to exclude self
      0.5 // similarity threshold
    );

    // Filter out the source video and format response
    const videos = searchResult.results
      .filter((v: any) => v.video_id !== videoId)
      .slice(0, limit)
      .map((v: any) => ({
        id: v.video_id,
        title: v.title,
        channel_name: v.channel_name,
        thumbnail_url: `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`,
        view_count: v.view_count,
        published_at: v.published_at,
        similarity_score: v.similarity_score
      }));

    return NextResponse.json({ videos });
  } catch (error) {
    console.error('Error in title vector search:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}