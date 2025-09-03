import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

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

// Extract video ID from URL
function extractVideoId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/);
  return match ? match[1] : null;
}

export async function POST(request: NextRequest) {
  try {
    cleanupOldVideos();
    
    const { url } = await request.json();
    
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({ error: 'Invalid YouTube URL' }, { status: 400 });
    }

    // Get video info first
    const infoCommand = `yt-dlp --dump-json "${url}"`;
    const { stdout: infoJson } = await execAsync(infoCommand);
    const info = JSON.parse(infoJson);
    
    const title = info.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${videoId}_${title}.mp4`;
    const filepath = path.join(tempDir, filename);
    const publicPath = `/temp-videos/${filename}`;
    
    // Check if video already exists
    if (fs.existsSync(filepath)) {
      console.log('Using cached video:', filename);
      return NextResponse.json({
        success: true,
        videoUrl: publicPath,
        title: info.title,
        duration: info.duration,
        thumbnail: info.thumbnail,
        quality: 'cached',
        cached: true
      });
    }

    // Download with yt-dlp at maximum quality
    // -f 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best' - Gets best quality MP4
    // --merge-output-format mp4 - Ensures output is MP4
    const downloadCommand = `yt-dlp -f 'bestvideo[height<=2160][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=2160]+bestaudio/best[height<=2160]/best' --merge-output-format mp4 -o "${filepath}" "${url}"`;
    
    console.log('Downloading video with command:', downloadCommand);
    
    // Execute download
    const { stdout, stderr } = await execAsync(downloadCommand, {
      maxBuffer: 1024 * 1024 * 100 // 100MB buffer
    });
    
    // Log output for debugging
    console.log('Download stdout:', stdout);
    if (stderr) console.log('Download stderr:', stderr);
    
    // Get actual quality of downloaded video
    const qualityCommand = `yt-dlp --get-filename -o '%(height)sp %(fps)sfps' "${url}"`;
    const { stdout: qualityInfo } = await execAsync(qualityCommand).catch(() => ({ stdout: 'unknown' }));
    
    return NextResponse.json({
      success: true,
      videoUrl: publicPath,
      title: info.title,
      duration: info.duration,
      thumbnail: info.thumbnail,
      quality: qualityInfo.trim(),
      fileSize: fs.statSync(filepath).size
    });

  } catch (error: any) {
    console.error('Error processing video:', error);
    
    let errorMessage = 'Failed to process video.';
    
    if (error.message) {
      if (error.message.includes('private')) {
        errorMessage = 'This video is private and cannot be downloaded.';
      } else if (error.message.includes('age')) {
        errorMessage = 'This video is age-restricted and cannot be downloaded.';
      } else if (error.message.includes('not found')) {
        errorMessage = 'Video not found. It may have been deleted.';
      } else {
        errorMessage = error.message.substring(0, 200); // Limit error message length
      }
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}