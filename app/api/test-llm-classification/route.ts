import { NextResponse } from 'next/server';
import { llmFormatClassificationService } from '@/lib/llm-format-classification-service';

export async function GET() {
  try {
    // Test data - sample videos with different formats
    const testVideos = [
      {
        id: 'test1',
        title: 'How to Build a DIY Bookshelf - Step by Step Tutorial',
        channel: 'DIY Woodworking',
        description: 'Learn how to build a beautiful bookshelf from scratch with basic tools.'
      },
      {
        id: 'test2',
        title: '10 Amazing Woodworking Tips You Need to Know',
        channel: 'Woodworking Pro',
        description: 'Discover the best tips and tricks to improve your woodworking skills.'
      },
      {
        id: 'test3',
        title: 'What is Mortise and Tenon Joinery? Explained',
        channel: 'Wood Theory',
        description: 'Understanding the fundamentals of this classic woodworking joint.'
      },
      {
        id: 'test4',
        title: 'Festool Domino vs Traditional Joinery - Which is Better?',
        channel: 'Tool Reviews',
        description: 'Comprehensive comparison of modern and traditional joinery methods.'
      },
      {
        id: 'test5',
        title: 'My Journey From Hobbyist to Professional Woodworker',
        channel: 'Makers Life',
        description: 'Sharing my personal story of turning woodworking into a career.'
      }
    ];

    // Run classification
    const result = await llmFormatClassificationService.classifyBatch(testVideos);
    
    // Format results for display
    const formattedResults = result.classifications.map(c => {
      const video = testVideos.find(v => v.id === c.videoId);
      return {
        title: video?.title,
        format: c.format,
        confidence: `${(c.confidence * 100).toFixed(0)}%`,
        reasoning: c.reasoning
      };
    });

    return NextResponse.json({
      success: true,
      summary: {
        videosProcessed: result.classifications.length,
        totalTokens: result.totalTokens,
        processingTimeMs: result.processingTimeMs,
        avgTokensPerVideo: Math.round(result.totalTokens / result.classifications.length)
      },
      results: formattedResults
    });
    
  } catch (error) {
    console.error('Test classification error:', error);
    return NextResponse.json(
      { error: 'Failed to run test classification' },
      { status: 500 }
    );
  }
}