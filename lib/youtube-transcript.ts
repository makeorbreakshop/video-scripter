import { extractYouTubeId } from './utils.ts';
import { getAppUrl } from './env-config.ts';

/**
 * Fetches transcript for a YouTube video using our backend API route
 * This avoids CORS issues by making the request server-side
 * @returns Formatted transcript text with timestamps and paragraphs
 */
export async function getYoutubeTranscript(videoUrl: string): Promise<string> {
  const videoId = extractYouTubeId(videoUrl);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  try {
    console.log(`🎬 Fetching transcript for video: ${videoId}`);
    
    // Get the base URL for API requests that works both client and server-side
    const baseUrl = typeof window !== 'undefined' 
      ? window.location.origin 
      : getAppUrl();
    
    // Use our internal API route to fetch the transcript server-side
    const response = await fetch(`${baseUrl}/api/youtube/transcript`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoUrl }),
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error(`🚨 Failed to fetch transcript: ${response.status}`, errorData);
      return `Failed to fetch transcript. Status: ${response.status}`;
    }
    
    const data = await response.json();
    const rawTranscript = data.transcript;
    
    // Improved formatting of the transcript to be more readable
    // First split the transcript into lines and clean them up
    const lines = rawTranscript.split('\n\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);
    
    // Combine into continuous text with minimal spacing
    // Create paragraphs intelligently based on content
    let formattedTranscript = '';
    const linesPerParagraph = 4; // Number of lines to include in each paragraph
    
    for (let i = 0; i < lines.length; i++) {
      if (i > 0 && i % linesPerParagraph === 0) {
        formattedTranscript += '\n\n'; // Paragraph break every few lines
      } else if (i > 0) {
        formattedTranscript += ' '; // Space between lines within a paragraph
      }
      
      formattedTranscript += lines[i];
    }
    
    // Convert to HTML with proper paragraph tags for rich text editor
    // Use fewer paragraph breaks to reduce excessive spacing
    const htmlFormatted = formattedTranscript.split('\n\n')
      .map(para => `<p>${para}</p>`)
      .join('');
    
    return htmlFormatted;
  } catch (error) {
    console.error('🚨 Error fetching YouTube transcript:', error);
    throw new Error(`Failed to fetch transcript: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
} 