/**
 * Parses ISO 8601 duration format (PT1M, PT17M17S, etc.) to seconds
 * Used for filtering YouTube Shorts (≤121 seconds) in performance envelope calculations
 */
export function parseDurationToSeconds(duration: string): number {
  if (!duration) return 0;
  
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  
  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0'); 
  const seconds = parseInt(match[3] || '0');
  
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Filters out YouTube Shorts based on duration
 * Returns true if video should be INCLUDED in performance envelope analysis
 */
export function shouldIncludeInEnvelope(duration: string): boolean {
  const durationSeconds = parseDurationToSeconds(duration);
  return durationSeconds > 121; // Exclude Shorts (≤121 seconds)
}

/**
 * Formats seconds back to human-readable duration
 * Useful for debugging and validation
 */
export function formatSecondsToReadable(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}