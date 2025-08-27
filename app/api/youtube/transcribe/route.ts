import { NextRequest, NextResponse } from 'next/server';
import ytdl from '@distube/ytdl-core';
import OpenAI from 'openai';
import { Readable } from 'stream';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface Chapter {
  title: string;
  startTime: number;
  endTime?: number;
  formattedTime: string;
}

interface TranscriptSegment {
  text: string;
  start: number;
  duration: number;
  chapter?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { videoId, includeChapters = true } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    console.log(`🎬 Processing video: ${videoId}`);

    // Get video metadata from YouTube API
    const youtubeApiKey = process.env.YOUTUBE_API_KEY;
    if (!youtubeApiKey) {
      return NextResponse.json(
        { error: 'YouTube API key not configured' },
        { status: 500 }
      );
    }

    // Fetch video details
    const videoResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${videoId}&key=${youtubeApiKey}`
    );

    if (!videoResponse.ok) {
      throw new Error('Failed to fetch video details');
    }

    const videoData = await videoResponse.json();
    
    if (!videoData.items || videoData.items.length === 0) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    const video = videoData.items[0];
    const snippet = video.snippet;
    const statistics = video.statistics;
    const contentDetails = video.contentDetails;

    // Parse duration from ISO 8601 format
    const parseDuration = (duration: string): number => {
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return 0;
      
      const hours = parseInt(match[1] || '0');
      const minutes = parseInt(match[2] || '0');
      const seconds = parseInt(match[3] || '0');
      
      return hours * 3600 + minutes * 60 + seconds;
    };

    const durationInSeconds = parseDuration(contentDetails.duration);

    // Remove duration check - we'll rely on the actual file size check instead
    // The 25MB limit typically allows 1-2 hours depending on compression

    console.log(`📥 Downloading audio from YouTube...`);

    // Download audio from YouTube
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Get video info first
    const info = await ytdl.getInfo(videoUrl);
    
    // Filter for audio-only formats
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
    
    if (audioFormats.length === 0) {
      return NextResponse.json(
        { error: 'No audio stream available for this video' },
        { status: 404 }
      );
    }

    // Download the audio stream
    const audioStream = ytdl(videoUrl, {
      quality: 'highestaudio',
      filter: 'audioonly',
    });

    // Convert stream to buffer for Whisper API
    const chunks: Buffer[] = [];
    
    await new Promise<void>((resolve, reject) => {
      audioStream.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      
      audioStream.on('end', () => {
        resolve();
      });
      
      audioStream.on('error', (error) => {
        reject(error);
      });
    });

    const audioBuffer = Buffer.concat(chunks);
    
    console.log(`🎙️ Audio downloaded: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB`);

    // Check size limit (25MB for Whisper)
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (audioBuffer.length > maxSize) {
      const sizeMB = (audioBuffer.length / 1024 / 1024).toFixed(2);
      const duration = Math.floor(durationInSeconds / 60);
      return NextResponse.json(
        { error: `Audio file too large (${sizeMB}MB). Maximum size is 25MB. This ${duration}-minute video exceeds the limit. Try a shorter video.` },
        { status: 400 }
      );
    }

    console.log(`🤖 Transcribing with Whisper...`);

    // Create a File object from the buffer for OpenAI API
    const audioFile = new File([audioBuffer], `${videoId}.mp3`, { type: 'audio/mpeg' });

    // Transcribe with Whisper - FORCE ENGLISH
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en', // Force English transcription
      response_format: 'verbose_json',
      timestamp_granularities: ['segment']
    });

    console.log(`✅ Transcription complete: ${transcription.segments?.length || 0} segments`);

    // Format transcript segments
    let transcript: TranscriptSegment[] = [];
    let fullText = transcription.text || '';

    if (transcription.segments && transcription.segments.length > 0) {
      transcript = transcription.segments.map((segment: any) => ({
        text: segment.text,
        start: segment.start || 0,
        duration: (segment.end || 0) - (segment.start || 0)
      }));
    } else {
      // If no segments, create a single segment
      transcript = [{
        text: fullText,
        start: 0,
        duration: durationInSeconds
      }];
    }

    // Extract chapters from description or detect from transcript
    let chapters: Chapter[] = [];
    
    if (includeChapters) {
      // Try to extract chapters from video description
      const description = snippet.description || '';
      chapters = extractChaptersFromDescription(description);
      
      // If no chapters in description, detect from transcript using AI
      if (chapters.length === 0 && transcript.length > 10) {
        chapters = await detectChaptersWithAI(transcript, durationInSeconds, fullText);
      }

      // Assign chapters to transcript segments
      if (chapters.length > 0) {
        transcript.forEach(segment => {
          const chapter = chapters.find((ch, index) => {
            const nextChapter = chapters[index + 1];
            return segment.start >= ch.startTime && 
              (nextChapter ? segment.start < nextChapter.startTime : true);
          });
          if (chapter) {
            segment.chapter = chapter.title;
          }
        });
      }
    }

    // Prepare metadata
    const metadata = {
      title: snippet.title,
      channel: snippet.channelTitle,
      duration: durationInSeconds,
      publishedAt: snippet.publishedAt,
      thumbnailUrl: snippet.thumbnails?.maxres?.url || 
                    snippet.thumbnails?.high?.url || 
                    snippet.thumbnails?.medium?.url ||
                    snippet.thumbnails?.default?.url,
      viewCount: parseInt(statistics.viewCount || '0'),
      description: snippet.description,
      language: transcription.language || 'en'
    };

    return NextResponse.json({
      metadata,
      transcript,
      chapters,
      fullText,
      whisperUsed: true
    });

  } catch (error) {
    console.error('Error in transcribe endpoint:', error);
    
    if (error instanceof Error) {
      // Handle specific ytdl errors
      if (error.message.includes('Status code: 410')) {
        return NextResponse.json(
          { error: 'This video is not available or has been removed.' },
          { status: 404 }
        );
      }
      
      if (error.message.includes('age-restricted')) {
        return NextResponse.json(
          { error: 'This video is age-restricted and cannot be transcribed.' },
          { status: 403 }
        );
      }

      if (error.message.includes('private video')) {
        return NextResponse.json(
          { error: 'This is a private video and cannot be transcribed.' },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to transcribe video' },
      { status: 500 }
    );
  }
}

function extractChaptersFromDescription(description: string): Chapter[] {
  const chapters: Chapter[] = [];
  
  // Common timestamp patterns in video descriptions
  const timestampRegex = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-–—]?\s*(.+)$/gm;
  const matches = description.matchAll(timestampRegex);
  
  for (const match of matches) {
    const hours = match[3] ? parseInt(match[1]) : 0;
    const minutes = match[3] ? parseInt(match[2]) : parseInt(match[1]);
    const seconds = match[3] ? parseInt(match[3]) : parseInt(match[2]);
    const title = match[4].trim();
    
    const startTime = hours * 3600 + minutes * 60 + seconds;
    
    chapters.push({
      title,
      startTime,
      formattedTime: formatTime(startTime)
    });
  }

  // Set end times for each chapter
  for (let i = 0; i < chapters.length - 1; i++) {
    chapters[i].endTime = chapters[i + 1].startTime;
  }

  return chapters;
}

async function detectChaptersWithAI(
  transcript: TranscriptSegment[], 
  videoDuration: number,
  fullText: string
): Promise<Chapter[]> {
  try {
    console.log(`🧠 Using AI to detect chapters...`);
    
    // Use GPT to analyze the transcript and identify chapters
    const prompt = `Analyze this video transcript and identify natural chapter breaks based on topic changes. 
The video is ${Math.floor(videoDuration / 60)} minutes long.

Return a JSON array of chapters with this format:
[
  { "title": "Chapter Title", "startTime": 0 },
  { "title": "Next Chapter", "startTime": 120 }
]

Rules:
- Minimum 30 seconds between chapters
- Maximum 10 chapters
- Start time in seconds
- Brief, descriptive titles (3-5 words)
- First chapter must start at 0

Transcript:
${fullText.substring(0, 5000)}...`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        { role: 'system', content: 'You are a video chapter detection assistant. Respond only with valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const response = completion.choices[0].message.content;
    if (!response) return [];

    const parsed = JSON.parse(response);
    const aiChapters = parsed.chapters || parsed;

    if (!Array.isArray(aiChapters)) return [];

    // Format and validate chapters
    const chapters: Chapter[] = aiChapters
      .filter((ch: any) => ch.title && typeof ch.startTime === 'number')
      .map((ch: any, index: number, arr: any[]) => ({
        title: ch.title,
        startTime: ch.startTime,
        endTime: arr[index + 1]?.startTime || videoDuration,
        formattedTime: formatTime(ch.startTime)
      }));

    console.log(`✅ AI detected ${chapters.length} chapters`);
    return chapters;
    
  } catch (error) {
    console.error('Failed to detect chapters with AI:', error);
    return [];
  }
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}