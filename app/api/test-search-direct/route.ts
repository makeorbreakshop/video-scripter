import { NextRequest, NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import { openai } from '@/lib/openai-client';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const { concept, threshold = 0.5, topK = 50 } = await req.json();
    
    if (!concept) {
      return NextResponse.json({ error: 'Concept is required' }, { status: 400 });
    }
    
    console.log('Testing direct search for:', concept);
    
    // Create embedding
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: concept,
      dimensions: 512
    });
    
    const embedding = response.data[0].embedding;
    
    // Direct Pinecone search
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
    
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    const queryResponse = await index.query({
      vector: embedding,
      topK: topK,
      includeMetadata: true,
    });
    
    console.log('Pinecone returned:', queryResponse.matches?.length, 'matches');
    console.log('First few scores:', queryResponse.matches?.slice(0, 5).map(m => ({ id: m.id, score: m.score })));
    
    // Get video details from Supabase using the IDs
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    const videoIds = queryResponse.matches?.map(m => m.id) || [];
    
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, view_count, channel_name')
      .in('id', videoIds);
    
    if (error) {
      console.error('Supabase error:', error);
    }
    
    // Combine results and filter by threshold
    const results = queryResponse.matches
      ?.filter(match => (match.score || 0) >= threshold)
      ?.map(match => {
        const video = videos?.find(v => v.id === match.id);
        return {
          id: match.id,
          score: match.score,
          title: video?.title || 'Not found',
          view_count: video?.view_count || 0,
          channel_name: video?.channel_name || 'Unknown'
        };
      }) || [];
    
    return NextResponse.json({
      success: true,
      concept,
      threshold,
      totalMatchesBeforeThreshold: queryResponse.matches?.length || 0,
      totalMatchesAfterThreshold: results.length,
      results: results.slice(0, 20),
      embeddingLength: embedding.length,
      scoreDistribution: {
        above_0_7: queryResponse.matches?.filter(m => (m.score || 0) >= 0.7).length || 0,
        above_0_6: queryResponse.matches?.filter(m => (m.score || 0) >= 0.6).length || 0,
        above_0_5: queryResponse.matches?.filter(m => (m.score || 0) >= 0.5).length || 0,
        above_0_4: queryResponse.matches?.filter(m => (m.score || 0) >= 0.4).length || 0,
        above_0_3: queryResponse.matches?.filter(m => (m.score || 0) >= 0.3).length || 0,
      }
    });
    
  } catch (error) {
    console.error('Test failed:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}