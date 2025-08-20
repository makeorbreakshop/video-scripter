import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { channelId, channelTitle, action = 'add' } = await request.json();

    if (!channelId) {
      return NextResponse.json(
        { error: 'Channel ID is required' },
        { status: 400 }
      );
    }

    // Use service role for admin operations
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    if (action === 'add') {
      // First check if channel exists
      const { data: existingChannel } = await supabase
        .from('channels')
        .select('channel_id, channel_name, is_institutional')
        .eq('channel_id', channelId)
        .single();

      if (existingChannel) {
        // Update existing channel
        const { error: updateError } = await supabase
          .from('channels')
          .update({
            is_institutional: true,
            updated_at: new Date().toISOString()
          })
          .eq('channel_id', channelId);

        if (updateError) {
          console.error('Error updating channel:', updateError);
          return NextResponse.json(
            { error: `Failed to mark channel as institutional: ${updateError.message}` },
            { status: 500 }
          );
        }
      } else {
        // Insert new channel
        const { error: insertError } = await supabase
          .from('channels')
          .insert({
            channel_id: channelId,
            channel_name: channelTitle || channelId,
            is_institutional: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (insertError) {
          console.error('Error inserting channel:', insertError);
          return NextResponse.json(
            { error: `Failed to add channel as institutional: ${insertError.message}` },
            { status: 500 }
          );
        }
      }

      // Update all existing videos from this channel
      const { error: updateError } = await supabase
        .from('videos')
        .update({ is_institutional: true })
        .eq('channel_id', channelId);

      if (updateError) {
        console.error('Error updating videos:', updateError);
        // Don't fail - videos will be filtered by channel status anyway
      }

      // Verify the channel was marked
      const { data: verifyChannel } = await supabase
        .from('channels')
        .select('channel_id, channel_name, is_institutional')
        .eq('channel_id', channelId)
        .single();

      console.log(`✅ Channel marked as institutional: ${JSON.stringify(verifyChannel)}`);

      return NextResponse.json({
        success: true,
        message: `Successfully marked channel "${channelTitle || channelId}" as institutional. All current and future videos will be filtered.`,
        channel: verifyChannel
      });
    } else if (action === 'remove') {
      // Update channel to remove institutional status
      const { error: updateChannelError } = await supabase
        .from('channels')
        .update({ 
          is_institutional: false,
          updated_at: new Date().toISOString()
        })
        .eq('channel_id', channelId);

      if (updateChannelError) {
        console.error('Error updating channel:', updateChannelError);
        return NextResponse.json(
          { error: 'Failed to remove institutional status from channel' },
          { status: 500 }
        );
      }

      // Optionally unmark videos (you might want to keep them marked)
      const { error: updateError } = await supabase
        .from('videos')
        .update({ is_institutional: false })
        .eq('channel_id', channelId);

      if (updateError) {
        console.error('Error updating videos:', updateError);
      }

      return NextResponse.json({
        success: true,
        message: `Successfully removed channel "${channelTitle || channelId}" from institutional list`
      });
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use "add" or "remove"' },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('Error in mark-institutional API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint to list all institutional channels
export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('channels')
      .select('*')
      .eq('is_institutional', true)
      .order('channel_name');

    if (error) {
      console.error('Error fetching institutional channels:', error);
      return NextResponse.json(
        { error: 'Failed to fetch institutional channels' },
        { status: 500 }
      );
    }

    return NextResponse.json({ channels: data || [] });
  } catch (error) {
    console.error('Error in GET institutional channels:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}