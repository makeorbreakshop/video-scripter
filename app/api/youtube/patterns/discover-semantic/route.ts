import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase-client';
import { SemanticPatternDiscovery } from '@/lib/semantic-pattern-discovery';

export async function POST(request: NextRequest) {
  try {
    // Use imported supabase client
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get request parameters
    const body = await request.json();
    const {
      minClusterSize = 30,
      maxClusterSize = 500,
      similarityThreshold = 0.8,
      performanceThreshold = 2.0,
      testMode = false // If true, only process a small sample
    } = body;

    console.log('Starting semantic pattern discovery with params:', {
      minClusterSize,
      maxClusterSize,
      similarityThreshold,
      performanceThreshold,
      testMode
    });

    // Initialize the semantic pattern discovery service
    const discoveryService = new SemanticPatternDiscovery();
    await discoveryService.initialize();

    // Run discovery
    const patterns = await discoveryService.discoverSemanticPatterns({
      minClusterSize,
      maxClusterSize,
      similarityThreshold,
      performanceThreshold
    });

    // Get pattern count stats
    const patternStats = patterns.reduce((acc, pattern) => {
      acc[pattern.pattern_type] = (acc[pattern.pattern_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      success: true,
      patternsDiscovered: patterns.length,
      patternTypes: patternStats,
      patterns: testMode ? patterns.slice(0, 10) : patterns,
      message: `Discovered ${patterns.length} semantic patterns`
    });

  } catch (error) {
    console.error('Error in semantic pattern discovery:', error);
    return NextResponse.json(
      { 
        error: 'Failed to discover semantic patterns',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}