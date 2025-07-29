import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    // Get total videos needing summaries
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary', null)
      .neq('channel_name', 'Make or Break Shop')

    // Get videos with summaries
    const { count: completedVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('llm_summary', 'is', null)

    // Get recent job info
    const { data: recentJob } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'llm_summary')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Get worker control status
    const { data: control } = await supabase
      .from('worker_control')
      .select('*')
      .eq('worker_type', 'llm_summary')
      .single()

    const progress = {
      total: totalVideos || 0,
      completed: completedVideos || 0,
      remaining: (totalVideos || 0) - (completedVideos || 0),
      percentage: totalVideos ? ((completedVideos || 0) / totalVideos) * 100 : 0,
      isEnabled: control?.is_enabled || false,
      lastEnabledAt: control?.last_enabled_at,
      lastDisabledAt: control?.last_disabled_at,
      currentJob: recentJob && recentJob.status === 'processing' ? {
        id: recentJob.id,
        startedAt: recentJob.created_at,
        processed: recentJob.data?.processed || 0,
        failed: recentJob.data?.failed || 0,
        rate: recentJob.data?.rate || 0,
        lastUpdate: recentJob.data?.lastUpdate
      } : null,
      estimatedCost: {
        completed: (completedVideos || 0) * 0.000116,
        total: (totalVideos || 0) * 0.000116
      }
    }

    return NextResponse.json({ progress })
  } catch (error) {
    console.error('Error fetching LLM summary progress:', error)
    return NextResponse.json(
      { error: 'Failed to fetch progress' },
      { status: 500 }
    )
  }
}