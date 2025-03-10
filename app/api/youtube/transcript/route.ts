import { NextResponse } from 'next/server';

// Function to extract YouTube video ID from URL
function extractYouTubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

export async function POST(request: Request) {
  try {
    const { videoUrl } = await request.json();
    
    if (!videoUrl) {
      return NextResponse.json(
        { error: 'No video URL provided' },
        { status: 400 }
      );
    }
    
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }
    
    console.log(`🎬 Fetching transcript for video: ${videoId}`);
    
    // Step 1: Fetch the video page to get caption tracks
    const videoPageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
    const videoPageHtml = await videoPageResponse.text();
    
    // Extract the captionTracks data from the YouTube page
    const captionTracksMatch = videoPageHtml.match(/"captionTracks":\[(.*?)\]/);
    if (!captionTracksMatch) {
      console.log('⚠️ No caption tracks found in the video page');
      return NextResponse.json({
        transcript: 'No captions available for this video.'
      });
    }
    
    // Parse the tracks data
    const captionTracksData = JSON.parse(`[${captionTracksMatch[1]}]`);
    console.log(`✅ Found ${captionTracksData.length} caption tracks`);
    
    // Step 2: Find the best track to use (prefer English or auto-generated)
    let selectedTrack = null;
    
    // First try to find English track
    selectedTrack = captionTracksData.find((track: any) => 
      track.languageCode === 'en' && !track.kind
    );
    
    // If no English track, try auto-generated English
    if (!selectedTrack) {
      selectedTrack = captionTracksData.find((track: any) => 
        track.languageCode === 'en' && track.kind === 'asr'
      );
    }
    
    // Fall back to any track
    if (!selectedTrack && captionTracksData.length > 0) {
      selectedTrack = captionTracksData[0];
    }
    
    if (!selectedTrack) {
      console.log('⚠️ Could not select any caption track');
      return NextResponse.json({
        transcript: 'No usable captions found for this video.'
      });
    }
    
    console.log(`🔤 Selected caption track: ${selectedTrack.name?.simpleText || 'Unnamed'} (${selectedTrack.languageCode})`);
    
    // Step 3: Fetch the actual transcript data using the baseUrl from the selected track
    const transcriptUrl = selectedTrack.baseUrl;
    const transcriptResponse = await fetch(transcriptUrl);
    
    if (!transcriptResponse.ok) {
      console.error(`🚨 Failed to fetch transcript: ${transcriptResponse.status}`);
      return NextResponse.json({
        transcript: 'Failed to fetch transcript data.'
      });
    }
    
    const transcriptXml = await transcriptResponse.text();
    
    // Step 4: Parse the XML to extract readable text
    const textSegments = transcriptXml.match(/<text[^>]*>(.*?)<\/text>/g) || [];
    let transcript = '';

    if (textSegments.length === 0) {
      console.log('⚠️ No text segments found in transcript XML');
      return NextResponse.json({
        transcript: 'No text content found in the transcript for this video.'
      });
    }

    // Improved transcript formatting to create more natural text flow
    transcript = textSegments
      .map(segment => {
        // Extract the text content and decode HTML entities
        const text = segment.replace(/<[^>]*>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        return text.trim();
      })
      .filter(text => text.length > 0)
      // Join with single newlines instead of double newlines to reduce spacing
      .join('\n');

    console.log(`✅ Successfully extracted transcript with ${textSegments.length} segments`);
    console.log(`✅ Final transcript length: ${transcript.length} characters`);

    // Ensure we're returning non-empty content
    if (transcript.trim().length === 0) {
      console.log('⚠️ Transcript is empty after processing');
      return NextResponse.json({
        transcript: 'The transcript was retrieved but contains no text content.'
      });
    }

    return NextResponse.json({ transcript });
  } catch (error) {
    console.error('🚨 Error in transcript API route:', error);
    return NextResponse.json(
      { error: `Failed to fetch transcript: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
} 