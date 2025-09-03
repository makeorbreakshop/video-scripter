import { NextRequest, NextResponse } from 'next/server';
import ytdl from 'ytdl-core';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const videoId = searchParams.get('videoId');
    const quality = searchParams.get('quality') || 'highest';

    if (!videoId) {
      return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // Get video info
    const info = await ytdl.getInfo(url);
    
    // Get the best quality video format
    const format = ytdl.chooseFormat(info.formats, { 
      quality: quality === 'highest' ? 'highestvideo' : quality,
      filter: 'videoandaudio'
    });

    if (!format) {
      return NextResponse.json({ error: 'No suitable format found' }, { status: 404 });
    }

    // Create a stream from ytdl
    const stream = ytdl(url, { format });

    // Create response with video stream
    const response = new Response(stream as any, {
      headers: {
        'Content-Type': format.mimeType || 'video/mp4',
        'Content-Disposition': `attachment; filename="${info.videoDetails.title}.mp4"`,
      },
    });

    return response;
  } catch (error) {
    console.error('Error downloading video:', error);
    return NextResponse.json(
      { error: 'Failed to download video' },
      { status: 500 }
    );
  }
}