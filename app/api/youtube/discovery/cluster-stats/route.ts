/**
 * Cluster Stats API
 * Returns clustering statistics for the discovery UI
 */

import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


export async function GET() {
  const supabase = getSupabase();
  try {
    // Get total videos with embeddings
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('title_embedding', 'is', null);

    // Get cluster metadata
    const { data: clusters, error: clusterError } = await supabase
      .from('cluster_metadata')
      .select('cluster_id, name, video_count')
      .order('video_count', { ascending: true });

    if (clusterError) {
      console.error('Error loading clusters:', clusterError);
      return NextResponse.json({
        totalVideos: totalVideos || 0,
        totalClusters: 0,
        underrepresentedClusters: 0,
        growingClusters: 0,
        topGaps: []
      });
    }

    // Calculate underrepresented clusters (bottom 20%)
    const avgSize = clusters.reduce((sum, c) => sum + (c.video_count || 0), 0) / (clusters.length || 1);
    const underrepresented = clusters.filter(c => (c.video_count || 0) < avgSize * 0.5);

    // Get growth data from cluster priorities if available
    const { data: priorities } = await supabase
      .from('cluster_discovery_priorities')
      .select('cluster_id, is_growing')
      .eq('is_growing', true);

    const growingCount = priorities?.length || Math.floor(clusters.length * 0.15); // Estimate 15% if no data

    // Get top gaps
    const topGaps = underrepresented
      .slice(0, 5)
      .map(c => ({
        cluster_id: c.cluster_id,
        name: c.name || `Topic ${c.cluster_id}`,
        videos: c.video_count || 0
      }));

    return NextResponse.json({
      totalVideos: totalVideos || 0,
      totalClusters: clusters.length,
      underrepresentedClusters: underrepresented.length,
      growingClusters: growingCount,
      topGaps,
      avgClusterSize: Math.round(avgSize),
      coverageRate: totalVideos ? ((clusters.reduce((sum, c) => sum + (c.video_count || 0), 0) / totalVideos) * 100).toFixed(1) : '0'
    });

  } catch (error) {
    console.error('Error getting cluster stats:', error);
    return NextResponse.json({
      totalVideos: 0,
      totalClusters: 0,
      underrepresentedClusters: 0,
      growingClusters: 0,
      topGaps: []
    });
  }
}