import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: Request) {
  try {
    // Get videoId from query params
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');

    if (!videoId) {
      return NextResponse.json({ error: 'Missing videoId parameter' }, { status: 400 });
    }

    // Get transcript chunks from the database
    const { data, error } = await supabaseAdmin
      .from('chunks')
      .select('content, metadata')
      .eq('video_id', videoId)
      .eq('content_type', 'transcript')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching transcript:', error);
      return NextResponse.json({ error: 'Failed to fetch transcript' }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ transcript: null }, { status: 200 });
    }

    // Join all transcript chunks into a single transcript
    const transcriptText = data.map(chunk => chunk.content).join('\n\n');

    return NextResponse.json({ transcript: transcriptText }, { status: 200 });
  } catch (error) {
    console.error('Error in transcript API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 