import { NextRequest, NextResponse } from 'next/server';
import { pineconeService } from '@/lib/pinecone-service';
import { openai } from '@/lib/openai-client';

export async function GET(req: NextRequest) {
  try {
    console.log('Testing Pinecone connection...');
    
    // Get index stats
    const stats = await pineconeService.getIndexStats();
    console.log('Index stats:', stats);
    
    // Try a simple search for "cooking"
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'cooking',
      dimensions: 512
    });
    
    const embedding = response.data[0].embedding;
    console.log('Created test embedding with length:', embedding.length);
    
    // Search with very low threshold
    const searchResults = await pineconeService.searchSimilar(
      embedding,
      10,  // limit
      0.1  // very low threshold
    );
    
    return NextResponse.json({
      success: true,
      indexStats: stats,
      embeddingLength: embedding.length,
      searchResults: searchResults.results.length,
      firstFewResults: searchResults.results.slice(0, 3).map(r => ({
        title: r.title,
        score: r.similarity_score,
        video_id: r.video_id
      }))
    });
    
  } catch (error) {
    console.error('Test failed:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}