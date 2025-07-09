import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from('worker_control')
      .select('*')
      .in('worker_type', ['title_vectorization', 'thumbnail_vectorization']);
    
    if (error) {
      console.error('Error fetching worker control:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Transform to object for easier access
    const controls = data.reduce((acc, item) => {
      acc[item.worker_type] = {
        isEnabled: item.is_enabled,
        lastEnabledAt: item.last_enabled_at,
        lastDisabledAt: item.last_disabled_at
      };
      return acc;
    }, {} as Record<string, any>);
    
    return NextResponse.json({ controls });
  } catch (error) {
    console.error('Error in worker control GET:', error);
    return NextResponse.json(
      { error: 'Failed to fetch worker control status' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { workerType, enabled } = body;
    
    if (!workerType || typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'Missing workerType or enabled parameter' },
        { status: 400 }
      );
    }
    
    // Validate worker type
    if (!['title_vectorization', 'thumbnail_vectorization'].includes(workerType)) {
      return NextResponse.json(
        { error: 'Invalid worker type' },
        { status: 400 }
      );
    }
    
    // Update worker control
    const updateData: any = {
      is_enabled: enabled,
      updated_at: new Date().toISOString()
    };
    
    if (enabled) {
      updateData.last_enabled_at = new Date().toISOString();
    } else {
      updateData.last_disabled_at = new Date().toISOString();
    }
    
    const { data, error } = await supabase
      .from('worker_control')
      .update(updateData)
      .eq('worker_type', workerType)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating worker control:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({
      success: true,
      workerType,
      enabled,
      data
    });
  } catch (error) {
    console.error('Error in worker control POST:', error);
    return NextResponse.json(
      { error: 'Failed to update worker control' },
      { status: 500 }
    );
  }
}