import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('Testing classification service...');
    
    // Try to import the classification service
    const { videoClassificationService } = await import('@/lib/video-classification-service');
    
    console.log('Classification service imported successfully');
    
    // Try to load clusters
    await videoClassificationService.topicService.loadClusters();
    
    // Test with a sample video
    const testVideo = {
      id: 'test123',
      title: 'How to Build a Website with HTML and CSS - Tutorial for Beginners',
      titleEmbedding: new Array(512).fill(0).map(() => Math.random() - 0.5), // Random embedding for test
      channel: 'Test Channel',
      description: 'Learn web development basics'
    };
    
    // Classify the test video
    const classifications = await videoClassificationService.classifyBatch(
      [testVideo],
      { batchSize: 1, logLowConfidence: true }
    );
    
    return NextResponse.json({
      success: true,
      message: 'Classification service is working',
      testClassification: classifications[0],
      stats: videoClassificationService.getStatistics()
    });
    
  } catch (error) {
    console.error('Classification test error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}