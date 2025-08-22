import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


export async function POST(request: Request) {
  const supabase = getSupabase();
  try {
    const { batchSize = 1000 } = await request.json();

    // Check if baseline processing is needed
    const { data: needsProcessing, error: checkError } = await supabase
      .rpc('check_baseline_needed');
    
    if (checkError) {
      return NextResponse.json({ 
        error: 'Failed to check baseline status',
        details: checkError.message 
      }, { status: 500 });
    }

    if (!needsProcessing) {
      return NextResponse.json({ 
        message: 'No videos need baseline processing',
        processed: 0
      });
    }

    // Get count of pending videos
    const { data: pendingCount, error: countError } = await supabase
      .rpc('get_baseline_pending_count');
    
    if (countError) {
      console.error('Failed to get pending count:', countError);
    }

    // Trigger baseline processing
    const { data: processedCount, error: processError } = await supabase
      .rpc('trigger_baseline_processing', { batch_size: batchSize });
    
    if (processError) {
      return NextResponse.json({ 
        error: 'Failed to trigger baseline processing',
        details: processError.message 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      message: 'Baseline processing triggered successfully',
      processed: processedCount || 0,
      pending: pendingCount || 0,
      batchSize
    });

  } catch (error) {
    console.error('Baseline trigger error:', error);
    return NextResponse.json({ 
      error: 'Failed to trigger baseline processing',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET() {
  const supabase = getSupabase();
  try {
    // Check current baseline status
    const { data: needsProcessing } = await supabase
      .rpc('check_baseline_needed');
    
    const { data: pendingCount } = await supabase
      .rpc('get_baseline_pending_count');

    return NextResponse.json({ 
      needsProcessing: needsProcessing || false,
      pendingCount: pendingCount || 0
    });

  } catch (error) {
    console.error('Baseline status error:', error);
    return NextResponse.json({ 
      error: 'Failed to check baseline status',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}