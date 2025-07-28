/**
 * Utility functions to detect video types (shorts, music videos, etc.)
 */

/**
 * Parse ISO 8601 duration to seconds
 * @param {string} duration - ISO 8601 duration string (e.g., "PT1M30S")
 * @returns {number} Total seconds
 */
export function parseDurationToSeconds(duration) {
  if (!duration || typeof duration !== 'string') return null;
  
  // Match ISO 8601 duration format: PT[hours]H[minutes]M[seconds]S
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!match) return null;
  
  const hours = parseInt(match[1] || 0);
  const minutes = parseInt(match[2] || 0);
  const seconds = parseFloat(match[3] || 0);
  
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Detect if a video is a YouTube Short
 * @param {object} video - Video object with title and duration
 * @returns {boolean}
 */
export function isShort(video) {
  // Check title for #shorts hashtag
  if (video.title && video.title.toLowerCase().includes('#shorts')) {
    return true;
  }
  
  // Check duration (YouTube Shorts are max 60 seconds)
  if (video.duration) {
    const seconds = parseDurationToSeconds(video.duration);
    if (seconds !== null && seconds <= 60) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect if a video is a music video
 * @param {object} video - Video object with title and category_id
 * @returns {boolean}
 */
export function isMusicVideo(video) {
  if (!video.title) return false;
  
  const title = video.title.toLowerCase();
  const musicIndicators = [
    'official video',
    'music video',
    'official music video',
    'lyric video',
    'lyrics video',
    'official lyric video',
    '(official video)',
    '[official video]',
    '- official video',
    'visualizer',
    'official visualizer'
  ];
  
  // Check title for music video indicators
  if (musicIndicators.some(indicator => title.includes(indicator))) {
    return true;
  }
  
  // We don't have category_id in our data, so skip this check
  
  return false;
}

/**
 * Get video type classification
 * @param {object} video - Video object
 * @returns {string} 'short' | 'music' | 'regular'
 */
export function getVideoType(video) {
  if (isShort(video)) return 'short';
  if (isMusicVideo(video)) return 'music';
  return 'regular';
}

/**
 * Filter out shorts and music videos from a list
 * @param {array} videos - Array of video objects
 * @returns {array} Filtered array of regular videos
 */
export function filterRegularVideos(videos) {
  return videos.filter(video => getVideoType(video) === 'regular');
}