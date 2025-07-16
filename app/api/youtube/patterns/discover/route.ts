import { NextResponse } from 'next/server';
import { PatternDiscoveryService } from '@/lib/pattern-discovery-service';

export async function POST(request: Request) {
  console.log('🔍 Pattern Discovery API called');
  
  try {
    const body = await request.json();
    const {
      query,
      topic_cluster,
      min_performance = 2.0,
      min_confidence = 0.8,
      min_videos = 30,
      limit = 20
    } = body;

    console.log('Pattern discovery request:', {
      query,
      topic_cluster,
      min_performance,
      min_confidence,
      min_videos,
      limit
    });

    // Initialize pattern discovery service
    const discoveryService = new PatternDiscoveryService();

    // Set up analysis context
    const context = {
      topic_cluster_id: topic_cluster,
      min_performance,
      min_confidence,
      min_videos
    };

    // Discover patterns
    const patterns = await discoveryService.discoverPatternsInCluster(context);

    // Store patterns in database
    await discoveryService.storePatterns(patterns);

    // Return patterns (limited)
    const limitedPatterns = patterns.slice(0, limit);

    return NextResponse.json({
      success: true,
      patterns: limitedPatterns,
      total_discovered: patterns.length,
      context: {
        topic_cluster,
        min_performance,
        min_confidence,
        min_videos
      }
    });

  } catch (error) {
    console.error('Pattern discovery error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to discover patterns',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}