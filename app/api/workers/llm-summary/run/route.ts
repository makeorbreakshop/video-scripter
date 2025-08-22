import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'


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

    // Get count of videos needing summaries
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary', null)
      .neq('channel_name', 'Make or Break Shop')

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