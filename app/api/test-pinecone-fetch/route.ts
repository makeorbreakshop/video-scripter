import { NextRequest, NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';

export async function GET(req: NextRequest) {
  try {
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
    
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    
    // Try to fetch a specific vector by ID to see its structure
    // First, let's list some IDs
    const listResponse = await index.listPaginated({
      limit: 10,
      paginationToken: undefined
    });
    
    console.log('List response:', listResponse);
    
    // If we have vectors, fetch one to see its metadata
    let sampleVector = null;
    if (listResponse.vectors && listResponse.vectors.length > 0) {
      const firstId = listResponse.vectors[0].id;
      const fetchResponse = await index.fetch([firstId]);
      sampleVector = fetchResponse.records[firstId];
    }
    
    return NextResponse.json({
      success: true,
      vectorCount: listResponse.vectors?.length || 0,
      firstFewIds: listResponse.vectors?.slice(0, 5).map(v => v.id),
      sampleVector: sampleVector ? {
        id: sampleVector.id,
        hasValues: !!sampleVector.values,
        valuesLength: sampleVector.values?.length,
        metadata: sampleVector.metadata,
        firstFewValues: sampleVector.values?.slice(0, 5)
      } : null,
      pagination: listResponse.pagination
    });
    
  } catch (error) {
    console.error('Test failed:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}