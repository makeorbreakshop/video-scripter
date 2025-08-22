import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

export async function GET(request: Request) {
  const supabase = getSupabase();
  const { searchParams } = new URL(request.url);
  const threshold = parseFloat(searchParams.get('threshold') || '0.8');
  
  console.log('Counting videos with confidence <', threshold);
  
  try {
    const { count, error } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .lt('format_confidence', threshold)
      .not('format_type', 'is', null)
      .not('channel_id', 'is', null);
      
    if (error) {
      console.error('Error counting videos:', error);
      return NextResponse.json({ error: 'Failed to count videos' }, { status: 500 });
    }
    
    console.log('Found', count, 'videos below threshold', threshold);
    
    return NextResponse.json({ count: count || 0 });
    
  } catch (error) {
    console.error('Error in count-low-confidence:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}