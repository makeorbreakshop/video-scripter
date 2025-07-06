import { XMLParser } from 'fast-xml-parser';

export interface RSSVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  videoUrl: string;
  updatedAt: string;
}

export interface RSSFeedResult {
  videos: RSSVideo[];
  channelId: string;
  channelTitle: string;
  feedUrl: string;
  error?: string;
}

export interface ChannelMonitorResult {
  channelsProcessed: number;
  totalVideosFound: number;
  newVideosToImport: number;
  errors: string[];
  channels: {
    channelId: string;
    channelTitle: string;
    videosFound: number;
    newVideos: number;
    error?: string;
  }[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true
});

/**
 * Fetches and parses a YouTube RSS feed for a given channel
 */
export async function fetchChannelRSSFeed(channelId: string): Promise<RSSFeedResult> {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  
  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'RSS-Channel-Monitor/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    const parsed = xmlParser.parse(xmlText);

    if (!parsed.feed) {
      throw new Error('Invalid RSS feed format - missing feed element');
    }

    const feed = parsed.feed;
    const channelTitle = feed.title || 'Unknown Channel';
    const entries = Array.isArray(feed.entry) ? feed.entry : (feed.entry ? [feed.entry] : []);

    const videos: RSSVideo[] = entries.map((entry: any) => {
      // Extract video ID from the entry ID (format: yt:video:VIDEO_ID)
      const videoId = entry.id?.split(':').pop() || '';
      
      return {
        id: videoId,
        title: entry.title || 'Untitled Video',
        description: entry['media:group']?.['media:description'] || entry.summary || '',
        publishedAt: entry.published || new Date().toISOString(),
        channelId: channelId,
        channelTitle: channelTitle,
        thumbnailUrl: entry['media:group']?.['media:thumbnail']?.['@_url'] || '',
        videoUrl: entry.link?.['@_href'] || `https://www.youtube.com/watch?v=${videoId}`,
        updatedAt: entry.updated || entry.published || new Date().toISOString()
      };
    });

    return {
      videos,
      channelId,
      channelTitle,
      feedUrl,
    };

  } catch (error) {
    console.error(`❌ Failed to fetch RSS feed for channel ${channelId}:`, error);
    return {
      videos: [],
      channelId,
      channelTitle: 'Unknown Channel',
      feedUrl,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Gets all unique channel IDs from the videos table
 */
export async function getAllChannelIds(): Promise<string[]> {
  try {
    const response = await fetch('/api/youtube/get-channels', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch channels: ${response.statusText}`);
    }

    const data = await response.json();
    return data.channels || [];
  } catch (error) {
    console.error('❌ Failed to get channel IDs:', error);
    return [];
  }
}

/**
 * Filters videos to only include those newer than the most recent video for each channel
 */
export function filterNewVideos(
  rssVideos: RSSVideo[],
  existingVideos: { id: string; published_at: string; channel_id: string; metadata?: any }[]
): RSSVideo[] {
  // Create a map of channel_id -> most recent video timestamp
  const channelLatestMap: { [channelId: string]: string } = {};
  
  existingVideos.forEach(video => {
    // Use YouTube channel ID from metadata if available, otherwise use channel_id
    const videoChannelId = video.metadata?.youtube_channel_id || video.channel_id;
    const current = channelLatestMap[videoChannelId];
    if (!current || new Date(video.published_at) > new Date(current)) {
      channelLatestMap[videoChannelId] = video.published_at;
    }
  });

  // Also check for existing video IDs to avoid duplicates
  const existingVideoIds = new Set(existingVideos.map(v => v.id));

  return rssVideos.filter(video => {
    // Skip if video already exists
    if (existingVideoIds.has(video.id)) {
      return false;
    }

    // Skip if video is older than most recent video for this channel
    const latestForChannel = channelLatestMap[video.channelId];
    if (latestForChannel && new Date(video.publishedAt) <= new Date(latestForChannel)) {
      return false;
    }

    return true;
  });
}

/**
 * Monitors all channels for new videos using RSS feeds
 */
export async function monitorAllChannels(): Promise<ChannelMonitorResult> {
  const result: ChannelMonitorResult = {
    channelsProcessed: 0,
    totalVideosFound: 0,
    newVideosToImport: 0,
    errors: [],
    channels: []
  };

  try {
    // Get all channel IDs from existing videos
    const channelIds = await getAllChannelIds();
    
    if (channelIds.length === 0) {
      result.errors.push('No channels found in database');
      return result;
    }

    // Process channels in batches to avoid overwhelming the system
    const BATCH_SIZE = 10;
    const batches = [];
    
    for (let i = 0; i < channelIds.length; i += BATCH_SIZE) {
      batches.push(channelIds.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      const batchPromises = batch.map(channelId => fetchChannelRSSFeed(channelId));
      const batchResults = await Promise.all(batchPromises);
      
      for (const feedResult of batchResults) {
        result.channelsProcessed++;
        result.totalVideosFound += feedResult.videos.length;
        
        const channelResult = {
          channelId: feedResult.channelId,
          channelTitle: feedResult.channelTitle,
          videosFound: feedResult.videos.length,
          newVideos: 0,
          error: feedResult.error
        };

        if (feedResult.error) {
          result.errors.push(`Channel ${feedResult.channelId}: ${feedResult.error}`);
        } else {
          // For now, count all videos as "new" - actual filtering will happen during import
          channelResult.newVideos = feedResult.videos.length;
          result.newVideosToImport += feedResult.videos.length;
        }

        result.channels.push(channelResult);
      }
    }

    return result;

  } catch (error) {
    console.error('❌ Failed to monitor channels:', error);
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    return result;
  }
}

/**
 * Converts RSS video data to format compatible with import-competitor API
 */
export function convertRSSVideoToImportFormat(rssVideo: RSSVideo) {
  return {
    id: rssVideo.id,
    snippet: {
      title: rssVideo.title,
      description: rssVideo.description,
      publishedAt: rssVideo.publishedAt,
      channelId: rssVideo.channelId,
      channelTitle: rssVideo.channelTitle,
      thumbnails: {
        default: { url: rssVideo.thumbnailUrl },
        medium: { url: rssVideo.thumbnailUrl },
        high: { url: rssVideo.thumbnailUrl }
      }
    },
    statistics: {
      viewCount: '0', // RSS doesn't provide view count
      likeCount: '0',
      commentCount: '0'
    },
    contentDetails: {
      duration: 'PT0S' // RSS doesn't provide duration
    }
  };
}