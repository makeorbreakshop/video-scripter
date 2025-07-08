import { NextRequest, NextResponse } from 'next/server';
import { testThumbnailEmbedding } from '@/lib/thumbnail-embeddings';

export async function GET(request: NextRequest) {
  try {
    console.log('🧪 Testing Replicate CLIP integration...');
    
    // Test with a known YouTube thumbnail
    const testUrl = "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg";
    
    const result = await testThumbnailEmbedding(testUrl);
    
    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Replicate CLIP integration working correctly!',
        data: {
          embeddingDimensions: result.embedding?.length || 0,
          cost: '$0.00098',
          testUrl
        }
      });
    } else {
      return NextResponse.json({
        success: false,
        error: result.error,
        message: 'Replicate CLIP test failed'
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('❌ Test API error:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to test Replicate integration'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { thumbnailUrl } = await request.json();
    
    if (!thumbnailUrl) {
      return NextResponse.json({
        success: false,
        error: 'thumbnailUrl is required'
      }, { status: 400 });
    }
    
    console.log(`🧪 Testing custom thumbnail: ${thumbnailUrl}`);
    
    const result = await testThumbnailEmbedding(thumbnailUrl);
    
    return NextResponse.json({
      success: result.success,
      data: result.success ? {
        embeddingDimensions: result.embedding?.length || 0,
        cost: '$0.00098',
        thumbnailUrl
      } : undefined,
      error: result.error
    });
    
  } catch (error) {
    console.error('❌ Custom test API error:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}