import { NextResponse } from 'next/server';
import { SemanticPatternDiscovery } from '@/lib/semantic-pattern-discovery';

export async function GET() {
  try {
    console.log('🧪 Testing semantic pattern discovery...');
    
    const discovery = new SemanticPatternDiscovery();
    await discovery.initialize();

    const patterns = await discovery.discoverPatterns({
      topic_cluster_id: 9, // Cooking cluster
      min_neighborhood_size: 10, // Lower threshold for testing
      min_performance: 1.5,
      similarity_threshold: 0.8
    });

    return NextResponse.json({
      success: true,
      patternsFound: patterns.length,
      patterns: patterns.slice(0, 5).map(p => ({
        type: p.pattern_type,
        name: p.pattern_data.name,
        context: p.pattern_data.semantic_context,
        lift: p.performance_stats.lift_ratio,
        examples: p.pattern_data.examples.slice(0, 3),
        llm_analysis: (p.pattern_data as any).llm_analysis
      }))
    });

  } catch (error) {
    console.error('Semantic test error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}