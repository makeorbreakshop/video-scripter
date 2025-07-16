import { NextResponse } from 'next/server';
import { PatternDiscoveryService } from '@/lib/pattern-discovery-service';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    console.log('🧪 Testing pattern discovery...');
    
    // Get some high-performing videos from cluster 9
    const { data: videos, error } = await supabase
      .from('videos')
      .select('*')
      .eq('topic_cluster_id', 9)
      .not('rolling_baseline_views', 'is', null)
      .gt('rolling_baseline_views', 0)
      .limit(500);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Filter for high performers
    const highPerformers = videos?.filter(v => {
      const performanceRatio = v.view_count / v.rolling_baseline_views;
      const publishedDate = new Date(v.published_at);
      const daysSincePublished = (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
      const ageConfidence = Math.min(daysSincePublished / 30, 1.0);
      
      return performanceRatio >= 1.5 && ageConfidence >= 0.5;
    }) || [];

    console.log(`Found ${highPerformers.length} high performers`);

    // Test full pattern discovery with Claude validation
    const service = new PatternDiscoveryService();
    
    const context = {
      topic_cluster_id: 9,
      min_performance: 1.5,
      min_confidence: 0.5,
      min_videos: 10
    };

    console.log('Running full pattern discovery...');
    const patterns = await service.discoverPatternsInCluster(context);

    console.log(`Pattern discovery found ${patterns.length} patterns after Claude validation`);

    return NextResponse.json({
      success: true,
      highPerformersCount: highPerformers.length,
      patternsFound: patterns.length,
      patterns: patterns.slice(0, 5),
      sampleTitles: highPerformers.slice(0, 5).map(v => ({
        title: v.title,
        performance: (v.view_count / v.rolling_baseline_views).toFixed(1)
      }))
    });

  } catch (error) {
    console.error('Test discovery error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}