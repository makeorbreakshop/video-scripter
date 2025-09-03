import { NextRequest, NextResponse } from 'next/server';
import ytdl from '@distube/ytdl-core';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

// Create a ytdl agent for better reliability
const agent = ytdl.createAgent();

// Create temp directory if it doesn't exist
const tempDir = path.join(process.cwd(), 'public', 'temp-videos');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Clean up old videos (older than 1 hour)
function cleanupOldVideos() {
  const now = Date.now();
  const files = fs.readdirSync(tempDir);
  
  files.forEach(file => {
    const filePath = path.join(tempDir, file);
    const stats = fs.statSync(filePath);
    const age = now - stats.mtimeMs;
    
    if (age > 3600000) { // 1 hour
      fs.unlinkSync(filePath);
    }
  });
}

export async function POST(request: NextRequest) {
  try {
    cleanupOldVideos();
    
    const { url } = await request.json();
    
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Validate URL
    if (!ytdl.validateURL(url)) {
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
    }

    // Get video info with better error handling and agent
    const info = await ytdl.getInfo(url, { agent }).catch(err => {
      console.error('Error getting video info:', err.message);
      throw new Error('Failed to get video information. The video might be private or restricted.');
    });
    
    const videoId = info.videoDetails.videoId;
    const title = info.videoDetails.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    
    // Check if video already exists
    const filename = `${videoId}_${title}.mp4`;
    const filepath = path.join(tempDir, filename);
    const publicPath = `/temp-videos/${filename}`;
    
    if (fs.existsSync(filepath)) {
      // Video already downloaded - return cached version
      console.log('Using cached video:', filename);
      return NextResponse.json({
        success: true,
        videoUrl: publicPath,
        title: info.videoDetails.title,
        duration: info.videoDetails.lengthSeconds,
        thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
        quality: 'cached',
        cached: true
      });
    }

    // Get the highest quality video format available
    // Sort formats by quality (resolution and bitrate)
    const videoFormats = info.formats
      .filter(f => f.hasVideo)
      .sort((a, b) => {
        // First sort by resolution (height)
        const heightDiff = (b.height || 0) - (a.height || 0);
        if (heightDiff !== 0) return heightDiff;
        
        // Then by bitrate
        return (b.bitrate || 0) - (a.bitrate || 0);
      });

    // Try to get the highest quality format with both audio and video
    let format = videoFormats.find(f => f.hasAudio && f.hasVideo);
    
    // If no combined format, get the highest quality video
    // (YouTube often separates audio and video for high quality)
    if (!format) {
      format = videoFormats[0];
      console.log(`Selected video-only format: ${format?.height}p at ${format?.fps}fps`);
    } else {
      console.log(`Selected combined format: ${format?.height}p at ${format?.fps}fps`);
    }

    if (!format) {
      return NextResponse.json({ error: 'No suitable format found' }, { status: 404 });
    }

    // Log available qualities for debugging
    console.log('Available video qualities:', 
      videoFormats.map(f => `${f.height}p`).filter((v, i, a) => a.indexOf(v) === i).join(', ')
    );

    // Download the video with the selected format and agent
    const videoStream = ytdl(url, { 
      format: format,
      quality: 'highest',
      highWaterMark: 1 << 25, // 32MB buffer for smoother streaming
      agent: agent,
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br'
        }
      }
    });
    const writeStream = fs.createWriteStream(filepath);
    
    await pipeline(videoStream, writeStream);

    return NextResponse.json({
      success: true,
      videoUrl: publicPath,
      title: info.videoDetails.title,
      duration: info.videoDetails.lengthSeconds,
      thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
      quality: `${format.height}p${format.fps ? ` ${format.fps}fps` : ''}`,
      hasAudio: format.hasAudio
    });

  } catch (error: any) {
    console.error('Error processing video:', error);
    
    // More specific error messages based on the error type
    let errorMessage = 'Failed to process video.';
    
    if (error.message) {
      if (error.message.includes('private')) {
        errorMessage = 'This video is private and cannot be downloaded.';
      } else if (error.message.includes('age-restricted')) {
        errorMessage = 'This video is age-restricted and cannot be downloaded.';
      } else if (error.message.includes('Could not extract')) {
        errorMessage = 'YouTube has changed their API. Please try again later or contact support.';
      } else if (error.message.includes('404')) {
        errorMessage = 'Video not found. It may have been deleted.';
      } else {
        errorMessage = error.message;
      }
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}