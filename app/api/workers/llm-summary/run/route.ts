import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'
import { getSupabase } from '@/lib/supabase-lazy'
import { q } from '@/lib/admin/db'
import { SUMMARY_PENDING_COUNT_SQL } from '@/lib/app/video-text-routes'


export async function POST(request: Request) {
  const supabase = getSupabase();
  try {
    const body = await request.json()
    const { batchSize = 100 } = body

    // Check if there's already a running job
    const { data: runningJob } = await supabase
      .from('jobs')
      .select('*')
      .eq('type', 'llm_summary')
      .eq('status', 'processing')
      .single()

    if (runningJob) {
      return NextResponse.json(
        { error: 'A job is already running', jobId: runningJob.id },
        { status: 400 }
      )
    }

    // Get count of videos needing summaries, from video_text. `.is('llm_summary', null)` on
    // `videos` would size this job at the entire corpus once the null-out has run.
    const pending = await q<{ count: number }>(SUMMARY_PENDING_COUNT_SQL, ['Make or Break Shop'])
    const totalVideos = pending[0]?.count ?? 0

    // Create a new job
    const jobId = uuidv4()
    const { error: jobError } = await supabase
      .from('jobs')
      .insert({
        id: jobId,
        type: 'llm_summary',
        status: 'pending',
        created_at: new Date().toISOString(),
        data: {
          totalVideos,
          batchSize,
          processed: 0,
          failed: 0
        }
      })

    if (jobError) throw jobError

    // Enable the worker
    await supabase
      .from('worker_control')
      .upsert({
        worker_type: 'llm_summary',
        is_enabled: true,
        last_enabled_at: new Date().toISOString()
      }, {
        onConflict: 'worker_type'
      })

    return NextResponse.json({
      jobId,
      totalVideos,
      message: 'LLM summary job started. Make sure the worker is running: npm run worker:llm-summary'
    })
  } catch (error) {
    console.error('Error starting LLM summary job:', error)
    return NextResponse.json(
      { error: 'Failed to start job' },
      { status: 500 }
    )
  }
}