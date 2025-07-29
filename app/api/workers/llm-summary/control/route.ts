import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  try {
    const { data: control } = await supabase
      .from('worker_control')
      .select('*')
      .eq('worker_type', 'llm_summary')
      .single()

    if (!control) {
      // Create default control if it doesn't exist
      const { data: newControl } = await supabase
        .from('worker_control')
        .insert({
          worker_type: 'llm_summary',
          is_enabled: false,
          created_at: new Date().toISOString()
        })
        .select()
        .single()

      return NextResponse.json({ control: newControl })
    }

    return NextResponse.json({ control })
  } catch (error) {
    console.error('Error fetching worker control:', error)
    return NextResponse.json(
      { error: 'Failed to fetch control status' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { enabled } = await request.json()

    const updateData: any = {
      is_enabled: enabled,
      updated_at: new Date().toISOString()
    }

    if (enabled) {
      updateData.last_enabled_at = new Date().toISOString()
    } else {
      updateData.last_disabled_at = new Date().toISOString()
    }

    // Upsert the control record
    const { data: control, error } = await supabase
      .from('worker_control')
      .upsert({
        worker_type: 'llm_summary',
        ...updateData
      }, {
        onConflict: 'worker_type'
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ control })
  } catch (error) {
    console.error('Error updating worker control:', error)
    return NextResponse.json(
      { error: 'Failed to update control status' },
      { status: 500 }
    )
  }
}