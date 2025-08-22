import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { Pinecone } from '@pinecone-database/pinecone';

export async function GET(request: Request) {
  const supabase = getSupabase();
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


    // Get the source video
    const { data: sourceVideo, error: sourceError } = await supabase
      .from('videos')
      .select('id, title, llm_summary_embedding_synced')
      .eq('id', videoId)
      .single();

    if (sourceError || !sourceVideo) {
      console.error('Error fetching source video:', sourceError);
      return NextResponse.json(
        { error: 'Source video not found', details: sourceError?.message },
        { status: 404 }
      );
    }

    // Log what we found
    console.log('Source video embedding status:', {
      videoId,
      llm_summary_embedding_synced: sourceVideo.llm_summary_embedding_synced
    });

    // Skip the embedding check for now to see if embeddings exist in Pinecone
    // if (!sourceVideo.llm_summary_embedding_synced) {
    //   return NextResponse.json(
    //     { error: 'Source video has no description/summary embedding' },
    //     { status: 400 }
    //   );
    // }

    // Initialize Pinecone client to fetch the embedding
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
    
    // Use main index with llm-summaries namespace for description embeddings
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    // Fetch the source video's embedding from Pinecone main index with namespace
    console.log('Fetching from Pinecone:', { indexName: process.env.PINECONE_INDEX_NAME, namespace: 'llm-summaries', videoId });
    
    try {
      const fetchResponse = await index.namespace('llm-summaries').fetch([videoId]);
      console.log('Pinecone fetch response:', { 
        hasRecords: !!fetchResponse.records,
        recordIds: Object.keys(fetchResponse.records || {}),
        hasEmbedding: !!fetchResponse.records[videoId]?.values
      });
      
      const sourceEmbedding = fetchResponse.records[videoId]?.values;
      
      if (!sourceEmbedding) {
        return NextResponse.json(
          { error: 'Source video has no summary embedding in Pinecone', videoId },
          { status: 400 }
        );
      }

      // Search for similar videos in the same namespace
      const queryResponse = await index.namespace('llm-summaries').query({
        vector: sourceEmbedding,
        topK: limit + 1,
        includeMetadata: true,
      });

      // Get video details from Supabase for the similar videos
      const similarVideoIds = queryResponse.matches
        ?.filter(match => match.id !== videoId)
        .map(match => match.id) || [];

      if (similarVideoIds.length === 0) {
        return NextResponse.json({ videos: [] });
      }

      const { data: videos, error: videosError } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at')
        .in('id', similarVideoIds);

      if (videosError) {
        throw videosError;
      }

      // Merge with similarity scores and format response
      const videosWithScores = (videos || []).map(video => {
        const match = queryResponse.matches?.find(m => m.id === video.id);
        return {
          id: video.id,
          title: video.title,
          channel_name: video.channel_name,
          thumbnail_url: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
          view_count: video.view_count,
          published_at: video.published_at,
          similarity_score: match?.score || 0
        };
      });

      // Sort by similarity score
      videosWithScores.sort((a, b) => b.similarity_score - a.similarity_score);

      return NextResponse.json({ videos: videosWithScores.slice(0, limit) });
    } catch (pineconeError) {
      console.error('Pinecone fetch error:', pineconeError);
      return NextResponse.json(
        { error: 'Failed to fetch from Pinecone', details: pineconeError instanceof Error ? pineconeError.message : 'Unknown error' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in description vector search:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error',
        endpoint: 'description'
      },
      { status: 500 }
    );
  }
}