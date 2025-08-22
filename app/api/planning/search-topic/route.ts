import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase-lazy'


export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { query } = await request.json()

    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }

    // Search for videos related to the topic using embeddings
    const { data: embeddingData } = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: query,
        dimensions: 512
      })
    }).then(res => res.json())

    const embedding = embeddingData?.data?.[0]?.embedding

    // For now, use text search since we don't have embedding search set up
    // In production, you would use pgvector similarity search here
    const { data: videos, error } = await supabase
      .from('videos')
      .select('*')
      .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
      .not('view_count', 'is', null)
      .order('view_count', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Database search error:', error)
      return NextResponse.json({
        videos: [],
        patterns: [],
        outliers: []
      })
    }

    // Analyze the videos to find patterns and outliers
    const analyzedData = analyzeVideos(videos || [])

    return NextResponse.json({
      videos: videos || [],
      patterns: analyzedData.patterns,
      outliers: analyzedData.outliers
    })

  } catch (error) {
    console.error('Search topic error:', error)
    return NextResponse.json(
      { error: 'Failed to search topic' },
      { status: 500 }
    )
  }
}

function analyzeVideos(videos: any[]) {
  if (!videos.length) {
    return { patterns: [], outliers: [] }
  }

  // Calculate statistics
  const avgViews = videos.reduce((sum, v) => sum + (v.view_count || 0), 0) / videos.length
  const avgLikes = videos.reduce((sum, v) => sum + (v.like_count || 0), 0) / videos.length
  const avgEngagement = videos.reduce((sum, v) => sum + ((v.like_count || 0) / (v.view_count || 1)), 0) / videos.length

  // Find outliers (videos performing significantly better than average)
  const outliers = videos
    .filter(v => {
      const viewsRatio = (v.view_count || 0) / avgViews
      const likesRatio = (v.like_count || 0) / avgLikes
      const engagementRate = (v.like_count || 0) / (v.view_count || 1)
      const engagementRatio = engagementRate / avgEngagement

      return viewsRatio > 2 || likesRatio > 2 || engagementRatio > 1.5
    })
    .map(v => ({
      ...v,
      outlier_score: calculateOutlierScore(v, avgViews, avgLikes, avgEngagement),
      outlier_reason: determineOutlierReason(v, avgViews, avgLikes, avgEngagement)
    }))
    .sort((a, b) => b.outlier_score - a.outlier_score)
    .slice(0, 10)

  // Extract patterns from top performing videos
  const topVideos = videos
    .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
    .slice(0, 20)

  const patterns = extractPatterns(topVideos)

  return { patterns, outliers }
}

function calculateOutlierScore(video: any, avgViews: number, avgLikes: number, avgEngagement: number): number {
  const viewsScore = (video.view_count || 0) / avgViews
  const likesScore = video.like_count ? (video.like_count / avgLikes) : viewsScore // Use view score if no likes data
  const engagementRate = video.like_count ? (video.like_count / (video.view_count || 1)) : 0
  const engagementScore = avgEngagement > 0 ? (engagementRate / avgEngagement) : 0

  // If we have outlier_factor from the database, use it as well
  const outlierFactor = video.outlier_factor || 1

  return ((viewsScore + likesScore + engagementScore * 2) / 4) * outlierFactor
}

function determineOutlierReason(video: any, avgViews: number, avgLikes: number, avgEngagement: number): string {
  const viewsRatio = (video.view_count || 0) / avgViews
  const likesRatio = video.like_count ? (video.like_count / avgLikes) : 0
  const engagementRate = video.like_count ? (video.like_count / (video.view_count || 1)) : 0
  const engagementRatio = avgEngagement > 0 ? (engagementRate / avgEngagement) : 0

  // Check performance ratio if available
  if (video.performance_ratio > 3) return 'Exceptional channel performance'
  if (engagementRatio > 2) return 'Exceptional engagement rate'
  if (viewsRatio > 3) return 'Viral reach'
  if (likesRatio > 3) return 'Highly liked content'
  if (viewsRatio > 2 && engagementRatio > 1.5) return 'High views + engagement'
  if (video.outlier_factor > 2) return 'Statistical outlier'
  return 'Above average performance'
}

function extractPatterns(videos: any[]): any[] {
  const patterns = []

  // Title patterns
  const titleWords = videos
    .flatMap(v => v.title?.toLowerCase().split(/\s+/) || [])
    .filter((word: string) => word.length > 3)
  
  const wordFrequency = titleWords.reduce((acc: any, word: string) => {
    acc[word] = (acc[word] || 0) + 1
    return acc
  }, {})

  const commonWords = Object.entries(wordFrequency)
    .filter(([_, count]) => count as number > videos.length * 0.3)
    .map(([word]) => word)

  if (commonWords.length > 0) {
    patterns.push({
      type: 'title',
      name: 'Common Title Keywords',
      description: `These words appear in over 30% of successful videos`,
      examples: commonWords,
      frequency: commonWords.length
    })
  }

  // Duration patterns
  const durations = videos.map(v => v.duration_seconds || 0).filter(d => d > 0)
  if (durations.length > 0) {
    const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length
    patterns.push({
      type: 'duration',
      name: 'Optimal Video Length',
      description: `Most successful videos are around ${Math.round(avgDuration / 60)} minutes long`,
      examples: [`${Math.round(avgDuration / 60)} minutes`],
      frequency: durations.length
    })
  }

  return patterns
}