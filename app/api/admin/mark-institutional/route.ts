import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const { channelId, channelTitle } = await request.json();

    if (!channelId) {
      return NextResponse.json(
        { error: 'Channel ID is required' },
        { status: 400 }
      );
    }

    const supabase = createRouteHandlerClient({ cookies });

    // Update all videos from this channel to mark them as institutional
    const { error } = await supabase
      .from('videos')
      .update({ is_institutional: true })
      .eq('channel_id', channelId);

    if (error) {
      console.error('Error marking channel as institutional:', error);
      return NextResponse.json(
        { error: 'Failed to mark channel as institutional' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Successfully marked channel "${channelTitle || channelId}" as institutional`
    });

  } catch (error) {
    console.error('Error in mark-institutional API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}