import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Use the materialized view for accurate counts without 1000 row limit
    const { data: topics, error } = await supabase
      .from('topic_distribution_stats')
      .select('*')
      .order('video_count', { ascending: false });

    if (error) throw error;

    // Build hierarchy from the materialized view data
    const hierarchy: Record<string, any> = {};
      
    // Get total videos from first row
    const totalVideos = topics?.[0]?.total_count || 0;
    
    // For now, use the known count of channels with topics
    // This should be added to the materialized view in the future
    const totalChannels = 874;
    
    topics?.forEach(topic => {
      const level1 = topic.domain;
      const level2 = topic.niche;
      const level3 = topic.micro_topic;
      
      if (!hierarchy[level1]) {
        hierarchy[level1] = {
          name: level1,
          count: topic.domain_total,
          children: {}
        };
      }
      
      if (!hierarchy[level1].children[level2]) {
        hierarchy[level1].children[level2] = {
          name: level2,
          count: topic.niche_total,
          children: {}
        };
      }
      
      hierarchy[level1].children[level2].children[level3] = {
        name: level3,
        cluster_id: topic.topic_cluster_id,
        count: topic.video_count
      };
      });

      // Convert to array format
      const hierarchyArray = Object.values(hierarchy).map(level1 => ({
        ...level1,
        children: Object.values(level1.children).map((level2: any) => ({
          ...level2,
          children: Object.values(level2.children)
        }))
      }));

    return NextResponse.json({
      hierarchy: hierarchyArray.sort((a, b) => b.count - a.count),
      totalClusters: 216,
      totalVideos: totalVideos,
      totalChannels: totalChannels
    });

  } catch (error) {
    console.error('Error fetching topic hierarchy:', error);
    return NextResponse.json(
      { error: 'Failed to fetch topic hierarchy' },
      { status: 500 }
    );
  }
}