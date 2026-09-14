import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { q } from '@/lib/admin/db'
import { SUMMARY_PENDING_COUNT_SQL, SUMMARY_DONE_COUNT_SQL } from '@/lib/app/video-text-routes'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  try {
    // Counted over video_text, not over videos.llm_summary: after the null-out the old
    // `.is('llm_summary', null)` matched all 1.1 M rows and `.not(... 'is', null)` matched none,
    // which would have reported 0 % complete forever.
    const [pending, done] = await Promise.all([
      q<{ count: number }>(SUMMARY_PENDING_COUNT_SQL, ['Make or Break Shop']),
      q<{ count: number }>(SUMMARY_DONE_COUNT_SQL),
    ])
    const totalVideos = pending[0]?.count ?? 0
    const completedVideos = done[0]?.count ?? 0

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