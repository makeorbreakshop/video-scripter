import { extractYouTubeId } from './utils.ts';
import { getAppUrl } from './env-config.ts';

/**
 * Fetches metadata for a YouTube video (title, thumbnail, etc.)
 * @param videoUrl The YouTube video URL
 * @returns Promise with video metadata
 */
export async function getYoutubeVideoMetadata(videoUrl: string) {
  const videoId = extractYouTubeId(videoUrl);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  try {
    console.log(`🎬 Fetching metadata for video: ${videoId}`);
    
    // Get the base URL for API requests that works both client and server-side
    const baseUrl = typeof window !== 'undefined' 
      ? window.location.origin 
      : getAppUrl();
    
    // Use our internal API route to fetch the video details
    const response = await fetch(`${baseUrl}/api/youtube/video-details`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoUrl }),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error(`🚨 Failed to fetch video metadata: ${response.status}`, errorData);
      return {
        title: `YouTube Video (${videoId})`,
        channelTitle: 'Unknown Channel',
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, // Default thumbnail URL pattern
        videoId
      };
    }
    
    const data = await response.json();
    
    return {
      title: data.title || `YouTube Video (${videoId})`,
      channelTitle: data.channelTitle || 'Unknown Channel',
      thumbnailUrl: data.snippet?.thumbnails?.high?.url || 
                   data.snippet?.thumbnails?.medium?.url || 
                   data.snippet?.thumbnails?.default?.url || 
                   `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      description: data.description,
      publishedAt: data.publishedAt,
      viewCount: data.viewCount,
      likeCount: data.likeCount,
      videoId
    };
  } catch (error) {
    console.error('🚨 Error fetching YouTube metadata:', error);
    // Return basic metadata with thumbnail based on video ID
    return {
      title: `YouTube Video (${videoId})`,
      channelTitle: 'Unknown Channel',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      videoId
    };
  }
} 