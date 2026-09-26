import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase-lazy'
import { videoTextFor } from '@/lib/app/video-text'

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    // Check if environment variables are set
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('Missing Supabase environment variables')
      return NextResponse.json({ error: 'Configuration error' }, { status: 500 })
    }
    
    // Create Supabase client inside the function
    
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const onlyOutliers = searchParams.get('onlyOutliers') === 'true'
    const minViews = parseInt(searchParams.get('minViews') || '0')
    const limit = parseInt(searchParams.get('limit') || '100')
    const sampleMode = searchParams.get('sampleMode') || 'smart'
    const clusterId = searchParams.get('cluster')
    
    // Build query
    let query = supabase
      .from('videos')
      .select('*')
      .not('performance_ratio', 'is', null)
    
    // Apply sampling strategy
    switch (sampleMode) {
      case 'top':
        query = query.order('view_count', { ascending: false })
        break
      case 'recent':
        query = query.order('published_at', { ascending: false })
        break
      case 'smart':
        // Get a diverse mix: some top performers, some outliers, some regular
        query = query.order('performance_ratio', { ascending: false })
        break
      default:
        query = query.order('performance_ratio', { ascending: false })
    }
    
    query = query.limit(limit)
    
    // Apply filters
    if (minViews > 0) {
      query = query.gte('view_count', minViews)
    }
    
    if (onlyOutliers) {
      query = query.gte('performance_ratio', 3.0)
    }
    
    if (search) {
      query = query.ilike('title', `%${search}%`)
    }
    
    if (clusterId !== null) {
      query = query.eq('topic_cluster', parseInt(clusterId))
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error('Supabase query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    console.log(`Query returned ${data?.length || 0} videos (mode: ${sampleMode})`)
    
    // select('*') returns the text columns, which are cleared on `videos`; the response keeps its
    // shape by taking them from the accessor (lib/app/video-text-select-star.test.ts).
    const text = await videoTextFor((data ?? []).map((v: any) => v.id))

    // Process videos to add outlier status
    const processedVideos = data?.map(video => {
      // Calculate performance ratio if missing
      let performanceRatio = video.performance_ratio
      if (!performanceRatio && video.view_count && video.channel_avg_views) {
        performanceRatio = video.view_count / video.channel_avg_views
      }
      
      const t = text.get(String(video.id))
      return {
        ...video,
        description: t?.description ?? null,
        metadata: t?.metadata ?? null,
        llm_summary: t?.llmSummary ?? null,
        performance_ratio: performanceRatio || 0,
        isOutlier: performanceRatio && performanceRatio >= 3.0,
        formattedViews: video.view_count?.toLocaleString() || '0',
        formattedRatio: performanceRatio ? performanceRatio.toFixed(1) : '0.0'
      }
    })
    
    return NextResponse.json({ 
      videos: processedVideos || [],
      totalCount: 50000, // In production, get actual count
      sampleMode,
      limit 
    })
  } catch (error) {
    console.error('Error fetching videos:', error)
    return NextResponse.json({ error: 'Failed to fetch videos' }, { status: 500 })
  }
}