import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    // Get topic hierarchy with counts
    const { data: hierarchyData, error } = await supabase
      .rpc('get_topic_hierarchy_with_counts');

    if (error) {
      // Fallback to direct query if RPC doesn't exist
      const { data: topics, error: queryError } = await supabase
        .from('videos')
        .select('topic_cluster_id, topic_domain, topic_niche, topic_micro')
        .not('topic_cluster_id', 'is', null);

      if (queryError) throw queryError;

      // Build hierarchy manually
      const hierarchy: Record<string, any> = {};
      
      topics?.forEach(video => {
        const level1 = video.topic_domain || 'Uncategorized';
        const level2 = video.topic_niche || 'General';
        const level3 = video.topic_micro || `Cluster ${video.topic_cluster_id}`;
        
        if (!hierarchy[level1]) {
          hierarchy[level1] = {
            name: level1,
            count: 0,
            children: {}
          };
        }
        
        if (!hierarchy[level1].children[level2]) {
          hierarchy[level1].children[level2] = {
            name: level2,
            count: 0,
            children: {}
          };
        }
        
        if (!hierarchy[level1].children[level2].children[level3]) {
          hierarchy[level1].children[level2].children[level3] = {
            name: level3,
            cluster_id: video.topic_cluster_id,
            count: 0
          };
        }
        
        hierarchy[level1].count++;
        hierarchy[level1].children[level2].count++;
        hierarchy[level1].children[level2].children[level3].count++;
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
        hierarchy: hierarchyArray,
        totalClusters: 216,
        totalVideos: topics?.length || 0
      });
    }

    return NextResponse.json({
      hierarchy: hierarchyData,
      totalClusters: 216,
      totalVideos: hierarchyData?.reduce((sum: number, item: any) => sum + item.count, 0) || 0
    });

  } catch (error) {
    console.error('Error fetching topic hierarchy:', error);
    return NextResponse.json(
      { error: 'Failed to fetch topic hierarchy' },
      { status: 500 }
    );
  }
}