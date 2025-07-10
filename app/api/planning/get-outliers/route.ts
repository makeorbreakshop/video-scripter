import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper function to extract seconds from ISO 8601 duration
function extractDurationSeconds(duration: string | null): number {
  if (!duration) return 0
  
  // Handle PT#M#S format
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  
  const hours = parseInt(match[1] || '0')
  const minutes = parseInt(match[2] || '0')
  const seconds = parseInt(match[3] || '0')
  
  return hours * 3600 + minutes * 60 + seconds
}

export async function POST(request: NextRequest) {
  try {
    const { topic, timeframe } = await request.json()

    if (!topic) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    // Calculate date range based on timeframe
    const now = new Date()
    let startDate = new Date()
    
    switch (timeframe) {
      case 'recent':
        startDate.setDate(now.getDate() - 30)
        break
      case 'quarter':
        startDate.setMonth(now.getMonth() - 3)
        break
      case 'all':
      default:
        startDate = new Date('2020-01-01')
    }

    // Get embedding for the topic
    const { data: embeddingData } = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: topic,
        dimensions: 512
      })
    }).then(res => res.json())

    const embedding = embeddingData?.data?.[0]?.embedding

    // Search for videos with high performance metrics
    const { data: videos, error } = await supabase
      .from('videos')
      .select('*')
      .or(`title.ilike.%${topic}%,description.ilike.%${topic}%`)
      .gte('published_at', startDate.toISOString())
      .not('view_count', 'is', null)
      .order('view_count', { ascending: false })
      .limit(200)

    if (error) {
      console.error('Database search error:', error)
      return NextResponse.json({
        outliers: []
      })
    }

    return NextResponse.json({
      outliers: processOutliers(videos || [], timeframe)
    })

  } catch (error) {
    console.error('Get outliers error:', error)
    return NextResponse.json(
      { error: 'Failed to get outliers' },
      { status: 500 }
    )
  }
}

function processOutliers(videos: any[], timeframe: string): any[] {
  if (!videos.length) return []

  // Calculate baseline metrics for comparison
  const metrics = calculateBaselineMetrics(videos)
  
  // Find videos that significantly outperform the baseline
  const outliers = videos
    .map(video => {
      const performanceScore = calculatePerformanceScore(video, metrics)
      const outlierReason = determineOutlierReason(video, metrics)
      
      return {
        id: video.id,
        title: video.title,
        channel: video.channel_name || video.channel_id,
        views: video.view_count || 0,
        likes: video.like_count || 0,
        engagement_rate: video.view_count ? ((video.like_count || 0) / video.view_count * 100) : 0,
        published_at: video.published_at,
        thumbnail_url: video.thumbnail_url,
        outlier_score: performanceScore,
        outlier_reason: outlierReason,
        duration_seconds: extractDurationSeconds(video.duration)
      }
    })
    .filter(v => v.outlier_score > 1.5) // Only include significant outliers
    .sort((a, b) => b.outlier_score - a.outlier_score)
    .slice(0, 12)

  return outliers
}

function calculateBaselineMetrics(videos: any[]) {
  const validVideos = videos.filter(v => v.view_count > 0)
  
  if (!validVideos.length) {
    return {
      avgViews: 0,
      avgLikes: 0,
      avgEngagement: 0,
      medianViews: 0,
      topDecileViews: 0
    }
  }

  const views = validVideos.map(v => v.view_count || 0).sort((a, b) => a - b)
  const likes = validVideos.map(v => v.like_count || 0)
  const engagements = validVideos.map(v => (v.like_count || 0) / (v.view_count || 1))

  return {
    avgViews: views.reduce((sum, v) => sum + v, 0) / views.length,
    avgLikes: likes.reduce((sum, v) => sum + v, 0) / likes.length,
    avgEngagement: engagements.reduce((sum, v) => sum + v, 0) / engagements.length,
    medianViews: views[Math.floor(views.length / 2)],
    topDecileViews: views[Math.floor(views.length * 0.9)]
  }
}

function calculatePerformanceScore(video: any, metrics: any): number {
  const viewScore = (video.view_count || 0) / (metrics.medianViews || 1)
  const engagementRate = (video.like_count || 0) / (video.view_count || 1)
  const engagementScore = engagementRate / (metrics.avgEngagement || 0.01)
  
  // Weight engagement more heavily for quality content
  return (viewScore + engagementScore * 2) / 3
}

function determineOutlierReason(video: any, metrics: any): string {
  const viewRatio = (video.view_count || 0) / (metrics.medianViews || 1)
  const engagementRate = (video.like_count || 0) / (video.view_count || 1)
  const engagementRatio = engagementRate / (metrics.avgEngagement || 0.01)
  
  if (viewRatio > 10) return 'Viral breakthrough'
  if (engagementRatio > 3) return 'Exceptional engagement'
  if (viewRatio > 5 && engagementRatio > 2) return 'High reach + engagement'
  if (video.view_count > metrics.topDecileViews) return 'Top 10% performer'
  if (engagementRatio > 2) return 'Strong audience connection'
  return 'Above average performance'
}