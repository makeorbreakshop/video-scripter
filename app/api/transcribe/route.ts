import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('audio') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ 
        error: 'Invalid file type. Supported: MP3, WAV, M4A' 
      }, { status: 400 });
    }

    // Check file size (25MB limit for Whisper API)
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (file.size > maxSize) {
      return NextResponse.json({ 
        error: 'File too large. Maximum size: 25MB' 
      }, { status: 400 });
    }

    console.log(`Transcribing audio file: ${file.name}, size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);

    // Convert File to format expected by OpenAI
    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment']
    });

    // Return transcript with metadata
    return NextResponse.json({
      transcript: transcription.text,
      duration: transcription.duration,
      segments: transcription.segments,
      language: transcription.language,
      metadata: {
        filename: file.name,
        filesize: file.size,
        transcribed_at: new Date().toISOString()
      }
    });

  } catch (error: any) {
    console.error('Transcription error:', error);
    
    // Handle specific OpenAI errors
    if (error.code === 'file_too_large') {
      return NextResponse.json({ 
        error: 'Audio file is too large. Please use a file smaller than 25MB.' 
      }, { status: 400 });
    }
    
    if (error.code === 'invalid_request_error') {
      return NextResponse.json({ 
        error: 'Invalid audio file format or corrupted file.' 
      }, { status: 400 });
    }

    return NextResponse.json({ 
      error: 'Transcription failed. Please try again.' 
    }, { status: 500 });
  }
}