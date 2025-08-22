import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase-lazy'

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Configuration error' }, { status: 500 })
    }
    
    
    // Get all videos with topic clusters
    const { data: videos, error } = await supabase
      .from('videos')
      .select('topic_cluster')
      .not('topic_cluster', 'is', null)
    
    if (error) {
      console.error('Error fetching videos:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    console.log('Found videos with clusters:', videos?.length)
    const clusterStats = videos || []
    
    // Count videos per cluster
    const clusterCounts = new Map<number, number>()
    
    if (Array.isArray(videos)) {
      videos.forEach((item: any) => {
        if (item.topic_cluster !== null && item.topic_cluster !== undefined) {
          const cluster = item.topic_cluster
          clusterCounts.set(cluster, (clusterCounts.get(cluster) || 0) + 1)
        }
      })
    }
    
    console.log('Cluster counts:', Array.from(clusterCounts.entries()))
    
    // Get sample videos from each cluster for topic inference
    const clusters = []
    
    for (const [clusterId, count] of clusterCounts.entries()) {
      // Include all clusters including -1 (noise)
      
      // Get top videos from this cluster
      const { data: sampleVideos, error: sampleError } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, performance_ratio')
        .eq('topic_cluster', clusterId)
        .order('view_count', { ascending: false })
        .limit(5)
      
      if (!sampleError && sampleVideos) {
        // Infer topic from titles
        const titles = sampleVideos.map(v => v.title.toLowerCase())
        const commonWords = findCommonWords(titles)
        
        const topic = commonWords.length > 0 
          ? commonWords.join(' ')
          : clusterId === -1 
            ? 'Uncategorized'
            : `Topic ${clusterId}`
        
        clusters.push({
          id: clusterId,
          size: count,
          inferredTopic: topic,
          topVideos: sampleVideos,
          avgViews: sampleVideos.reduce((sum, v) => sum + (v.view_count || 0), 0) / sampleVideos.length,
          position: {
            // Position clusters in a grid pattern
            x: ((clusterId + 1) % 5) * 150 - 300,
            y: Math.floor((clusterId + 1) / 5) * 150 - 200
          }
        })
      }
    }
    
    // Sort by size
    clusters.sort((a, b) => b.size - a.size)
    
    return NextResponse.json({ 
      clusters,
      totalClusters: clusterCounts.size,
      totalVideos: Array.from(clusterCounts.values()).reduce((a, b) => a + b, 0)
    })
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Failed to fetch clusters' }, { status: 500 })
  }
}

function findCommonWords(titles: string[]): string[] {
  const wordFreq = new Map<string, number>()
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'how', 'what', 'when', 'where', 'who', 'why', 'can', 'could', 'should', 'would', 'will', 'make', 'made', 'get', 'got', 'your', 'my', 'our', 'their'])
  
  titles.forEach(title => {
    const words = title.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w))
    words.forEach(word => {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1)
    })
  })
  
  return Array.from(wordFreq.entries())
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word]) => word)
}