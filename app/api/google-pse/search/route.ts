import { NextRequest, NextResponse } from 'next/server';
import { googlePSE } from '@/lib/google-pse-service';
import { getSupabaseClient } from '@/lib/supabase-client';
import { quotaTracker } from '@/lib/youtube-quota-tracker';

// Extended interface for enriched channel data
interface EnrichedChannel extends ExtractedChannel {
  actualChannelId?: string;
  actualTitle?: string;
  subscriberCount?: number;
  videoCount?: number;
  viewCount?: number;
  description?: string;
  thumbnailUrl?: string;
  publishedAt?: string;
  uploadsPlaylistId?: string;
  lastVideoDate?: string;
  meetsFilters?: boolean;
  filterReasons?: string[];
}

async function fetchChannelDataFromYouTube(channels: ExtractedChannel[]): Promise<EnrichedChannel[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn('YouTube API key not configured - returning channels without enrichment');
    return channels;
  }

  const enrichedChannels: EnrichedChannel[] = [];
  
  // Group channels by type for efficient API calls
  const channelsWithIds = channels.filter(c => c.channelId);
  const channelsWithHandles = channels.filter(c => !c.channelId && c.channelUrl.includes('@'));
  
  // Batch process channels with IDs (up to 50 per request)
  if (channelsWithIds.length > 0) {
    for (let i = 0; i < channelsWithIds.length; i += 50) {
      const batch = channelsWithIds.slice(i, i + 50);
      const ids = batch.map(c => c.channelId).join(',');
      
      try {
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${ids}&key=${apiKey}`
        );
        
        if (response.ok) {
          const data = await response.json();
          
          // Track quota usage
          await quotaTracker.trackAPICall('channels.list', {
            description: `Fetch channel data for ${batch.length} channels`,
            count: batch.length
          });
          
          // Map the results back to our channels
          for (const item of data.items || []) {
            const originalChannel = batch.find(c => c.channelId === item.id);
            if (originalChannel) {
              enrichedChannels.push({
                ...originalChannel,
                actualChannelId: item.id,
                actualTitle: item.snippet.title,
                subscriberCount: parseInt(item.statistics.subscriberCount || '0'),
                videoCount: parseInt(item.statistics.videoCount || '0'),
                viewCount: parseInt(item.statistics.viewCount || '0'),
                description: item.snippet.description || '',
                thumbnailUrl: item.snippet.thumbnails?.default?.url || '',
                publishedAt: item.snippet.publishedAt,
                uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads || ''
              });
            }
          }
        }
      } catch (error) {
        console.error('Error fetching channel batch:', error);
      }
    }
  }
  
  // Process channels with handles (one by one, as forHandle doesn't support batch)
  for (const channel of channelsWithHandles) {
    const handleMatch = channel.channelUrl.match(/@([a-zA-Z0-9_-]+)/);
    if (!handleMatch) continue;
    
    const handle = handleMatch[1];
    
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&forHandle=${handle}&key=${apiKey}`
      );
      
      if (response.ok) {
        const data = await response.json();
        
        // Track quota usage
        await quotaTracker.trackAPICall('channels.list', {
          description: `Resolve handle @${handle}`,
          count: 1
        });
        
        if (data.items && data.items.length > 0) {
          const item = data.items[0];
          enrichedChannels.push({
            ...channel,
            actualChannelId: item.id,
            actualTitle: item.snippet.title,
            subscriberCount: parseInt(item.statistics.subscriberCount || '0'),
            videoCount: parseInt(item.statistics.videoCount || '0'),
            viewCount: parseInt(item.statistics.viewCount || '0'),
            description: item.snippet.description || '',
            thumbnailUrl: item.snippet.thumbnails?.default?.url || '',
            publishedAt: item.snippet.publishedAt,
            uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads || ''
          });
        } else {
          // No match found, keep original data
          enrichedChannels.push(channel);
        }
      } else {
        enrichedChannels.push(channel);
      }
    } catch (error) {
      console.error(`Error resolving handle @${handle}:`, error);
      enrichedChannels.push(channel);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  // Return any channels we couldn't enrich
  const processedUrls = new Set(enrichedChannels.map(c => c.channelUrl));
  const unprocessedChannels = channels.filter(c => !processedUrls.has(c.channelUrl));
  
  return [...enrichedChannels, ...unprocessedChannels];
}

// Import the type from google-pse-service
type ExtractedChannel = import('@/lib/google-pse-service').ExtractedChannel;

// Helper function to detect if content is primarily English
function isEnglishContent(channel: EnrichedChannel): boolean {
  const textToCheck = `${channel.actualTitle || channel.channelName} ${channel.description || ''}`;
  
  // Simple heuristic: check for non-Latin characters
  // This catches most non-English content (Arabic, Chinese, Japanese, Korean, etc.)
  const nonLatinPattern = /[\u0600-\u06FF\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/;
  if (nonLatinPattern.test(textToCheck)) {
    return false;
  }
  
  // Additional check for Cyrillic (Russian, etc.)
  const cyrillicPattern = /[\u0400-\u04FF]/;
  if (cyrillicPattern.test(textToCheck)) {
    return false;
  }
  
  // If it's mostly Latin characters, assume English
  // This isn't perfect but works for most cases
  return true;
}

// Helper function to check if channel has recent activity
async function checkRecentActivity(channel: EnrichedChannel, apiKey: string): Promise<Date | null> {
  if (!channel.uploadsPlaylistId) return null;
  
  try {
    // Get the most recent video from the uploads playlist
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${channel.uploadsPlaylistId}&maxResults=1&key=${apiKey}`
    );
    
    if (response.ok) {
      const data = await response.json();
      
      // Track quota usage
      await quotaTracker.trackAPICall('playlistItems.list', {
        description: `Check recent activity for ${channel.actualTitle}`,
        count: 1
      });
      
      if (data.items && data.items.length > 0) {
        const videoId = data.items[0].contentDetails.videoId;
        
        // Get video details to find publish date
        const videoResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`
        );
        
        if (videoResponse.ok) {
          const videoData = await videoResponse.json();
          
          // Track quota usage
          await quotaTracker.trackAPICall('videos.list', {
            description: `Get video date for activity check`,
            count: 1
          });
          
          if (videoData.items && videoData.items.length > 0) {
            return new Date(videoData.items[0].snippet.publishedAt);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error checking recent activity:', error);
  }
  
  return null;
}

// Apply filters to channels
async function applyFilters(channels: EnrichedChannel[], apiKey: string): Promise<EnrichedChannel[]> {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  // Process channels in parallel but with rate limiting
  const BATCH_SIZE = 10;
  const processedChannels: EnrichedChannel[] = [];
  
  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);
    
    const batchResults = await Promise.all(
      batch.map(async (channel) => {
        const filterReasons: string[] = [];
        let meetsFilters = true;
        
        // 1. Check subscriber count (>= 1000)
        if (channel.subscriberCount !== undefined && channel.subscriberCount < 1000) {
          filterReasons.push(`Only ${channel.subscriberCount} subscribers (min: 1000)`);
          meetsFilters = false;
        }
        
        // 2. Check language (English)
        if (!isEnglishContent(channel)) {
          filterReasons.push('Non-English content');
          meetsFilters = false;
        }
        
        // 3. Check recent activity (video in last 6 months)
        // Only check if other filters pass to save API quota
        let lastVideoDate: Date | null = null;
        if (meetsFilters && apiKey && channel.actualChannelId) {
          lastVideoDate = await checkRecentActivity(channel, apiKey);
          
          if (lastVideoDate) {
            channel.lastVideoDate = lastVideoDate.toISOString();
            
            if (lastVideoDate < sixMonthsAgo) {
              filterReasons.push(`Last video ${Math.floor((Date.now() - lastVideoDate.getTime()) / (1000 * 60 * 60 * 24 * 30))} months ago`);
              meetsFilters = false;
            }
          } else if (channel.videoCount && channel.videoCount > 0) {
            // Couldn't check activity but channel has videos - be conservative and filter out
            filterReasons.push('Could not verify recent activity');
            meetsFilters = false;
          }
          // If channel has 0 videos, don't filter based on activity
        }
        
        return {
          ...channel,
          meetsFilters,
          filterReasons
        };
      })
    );
    
    processedChannels.push(...batchResults);
    
    // Rate limiting between batches
    if (i + BATCH_SIZE < channels.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return processedChannels;
}

export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  try {
    const { query, includeDebug } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Check if Google PSE is configured
    if (!googlePSE.isConfigured()) {
      // Return mock data for testing when PSE is not configured
      console.warn('Google PSE not configured. Returning mock data.');
      
      const mockChannels = [
        {
          name: "Circuit Design Tutorial Channel",
          url: "https://youtube.com/@circuitdesign",
          channelId: "",
          confidence: "medium",
          source: "channel",
          videoTitle: "",
          videoUrl: "",
          isNew: true
        },
        {
          name: "PCB Design Academy",
          url: "https://youtube.com/@pcbacademy",
          channelId: "",
          confidence: "high",
          source: "video",
          videoTitle: "Complete PCB Design Course - Part 1",
          videoUrl: "https://youtube.com/watch?v=example123",
          isNew: true
        },
        {
          name: "Electronics Engineering Hub",
          url: "https://youtube.com/@eehub",
          channelId: "",
          confidence: "medium",
          source: "video",
          videoTitle: "Circuit Design Basics",
          videoUrl: "https://youtube.com/watch?v=example456",
          isNew: false
        }
      ];
      
      return NextResponse.json({
        success: true,
        query,
        channelsFound: mockChannels.length,
        channelsAdded: 2,
        duplicates: 1,
        totalResults: 25,
        channels: mockChannels,
        topResult: {
          title: mockChannels[0].name,
          channelUrl: mockChannels[0].url,
          confidence: mockChannels[0].confidence,
          videoTitle: mockChannels[0].videoTitle,
          subscribers: 0,
          autoApproved: false
        },
        timestamp: new Date().toISOString(),
        warning: 'Using mock data - Google PSE not configured'
      });
    }

    // Check quota
    const quotaStatus = await googlePSE.getQuotaStatus();
    if (quotaStatus.remaining <= 0) {
      return NextResponse.json(
        { error: 'Daily quota exceeded' },
        { status: 429 }
      );
    }

    // Perform the search
    console.log(`🔍 Searching Google PSE: "${query}"`);
    const searchResult = await googlePSE.searchYouTube(query, { 
      num: 10, // Get 10 results per search
      type: 'any', // Get both videos and channels
      includeRaw: includeDebug // Include raw results if debug mode is on
    });

    if (searchResult.error) {
      return NextResponse.json(
        { error: searchResult.error },
        { status: 400 }
      );
    }

    // Get unique channels from results
    const uniqueChannels = new Map<string, any>();
    for (const channel of searchResult.results) {
      const key = channel.channelUrl || channel.channelName;
      if (!uniqueChannels.has(key)) {
        uniqueChannels.set(key, channel);
      }
    }

    const channels = Array.from(uniqueChannels.values());

    // Check for duplicates in database
    const channelUrls = channels.map(c => c.channelUrl).filter(url => url);
    const channelIds = channels.map(c => c.channelId).filter(id => id);
    
    let existingChannelUrls: string[] = [];
    let existingChannelIds: string[] = [];
    
    if (channelUrls.length > 0 || channelIds.length > 0) {
      // MOST IMPORTANT: Check videos table for already imported channels
      if (channelIds.length > 0) {
        const { data: existingVideos } = await supabase
          .from('videos')
          .select('channel_id')
          .in('channel_id', channelIds)
          .limit(channelIds.length);
        
        const videoChannelIds = [...new Set((existingVideos || []).map(v => v.channel_id).filter(Boolean))];
        existingChannelIds.push(...videoChannelIds);
      }
      
      // Check channel_discovery table by channel ID
      if (channelIds.length > 0) {
        const { data: existingDiscovery } = await supabase
          .from('channel_discovery')
          .select('discovered_channel_id')
          .in('discovered_channel_id', channelIds);
        
        const discoveryIds = (existingDiscovery || []).map(d => d.discovered_channel_id).filter(Boolean);
        existingChannelIds.push(...discoveryIds);
      }
      
      // Check channel_discovery table by URL
      if (channelUrls.length > 0) {
        const { data: existingDiscoveryUrls } = await supabase
          .from('channel_discovery')
          .select('channel_metadata')
          .in('channel_metadata->>url', channelUrls);
        
        const urls = (existingDiscoveryUrls || []).map(e => e.channel_metadata?.url).filter(Boolean);
        existingChannelUrls.push(...urls);
      }
      
      // Check discovered_channels table (legacy) by URL
      if (channelUrls.length > 0) {
        const { data: existing1 } = await supabase
          .from('discovered_channels')
          .select('custom_url')
          .in('custom_url', channelUrls);
        
        const legacyUrls = (existing1 || []).map(e => e.custom_url).filter(Boolean);
        existingChannelUrls.push(...legacyUrls);
      }
      
      // Check discovered_channels table (legacy) by ID
      if (channelIds.length > 0) {
        const { data: existing2 } = await supabase
          .from('discovered_channels')
          .select('channel_id')
          .in('channel_id', channelIds);
        
        const legacyIds = (existing2 || []).map(e => e.channel_id).filter(Boolean);
        existingChannelIds.push(...legacyIds);
      }
    }
    
    // Deduplicate the arrays
    existingChannelUrls = [...new Set(existingChannelUrls)];
    existingChannelIds = [...new Set(existingChannelIds)];

    // Separate new vs duplicate channels (check both URL and ID)
    const newChannels = channels.filter(c => {
      const urlExists = existingChannelUrls.includes(c.channelUrl);
      const idExists = c.channelId && existingChannelIds.includes(c.channelId);
      return !urlExists && !idExists;
    });
    const duplicateCount = channels.length - newChannels.length;

    // Define enrichedChannels at the outer scope
    let enrichedChannels: EnrichedChannel[] | undefined;

    // Store new channels in discovery queue
    if (newChannels.length > 0) {
      // Step 2: Fetch actual channel data from YouTube API
      console.log('🔍 Fetching channel data from YouTube API...');
      enrichedChannels = await fetchChannelDataFromYouTube(newChannels);
      
      // Step 3: Apply filters
      console.log('🔍 Applying filters to channels...');
      enrichedChannels = await applyFilters(enrichedChannels, process.env.YOUTUBE_API_KEY!);
      
      // Separate channels that meet filters vs those that don't
      const channelsThatMeetFilters = enrichedChannels.filter(c => c.meetsFilters);
      const filteredOutChannels = enrichedChannels.filter(c => !c.meetsFilters);
      
      console.log(`✅ ${channelsThatMeetFilters.length} channels meet filters`);
      console.log(`❌ ${filteredOutChannels.length} channels filtered out`);
      
      // Only insert channels that meet filters into discovered_channels table
      const channelsToInsert = channelsThatMeetFilters.map(channel => ({
        channel_id: channel.actualChannelId || `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        channel_title: channel.actualTitle || channel.channelName,
        custom_url: channel.channelUrl,
        subscriber_count: channel.subscriberCount || 0,
        video_count: channel.videoCount || 0,
        view_count: channel.viewCount || 0,
        description: channel.description || '',
        published_at: channel.publishedAt || null,
        discovery_method: 'google_pse',
        search_query: query,
        search_type: 'google_pse',
        discovered_at: new Date().toISOString(),
        is_processed: true, // Mark as processed since we have YouTube data
        api_verified: !!channel.actualChannelId,
        meets_threshold: true, // All channels here meet our filters
        discovered_from_channel_id: null,
        discovery_depth: 0
      }));

      // Insert channels with conflict handling
      if (channelsToInsert.length > 0) {
        const { error: insertError } = await supabase
          .from('discovered_channels')
          .upsert(channelsToInsert, {
            onConflict: 'channel_id',
            ignoreDuplicates: true
          });

        if (insertError && insertError.code !== '23505') {
          console.error('Error inserting channels:', insertError);
        }
      }

      // Also insert into channel_discovery table for the import tab (only channels that meet filters)
      const discoveryRecords = channelsThatMeetFilters.map(channel => ({
        discovered_channel_id: channel.actualChannelId || channel.channelUrl,
        source_channel_id: 'google_pse', // Use 'google_pse' as source since it's required
        discovery_method: 'search', // Use 'search' to match existing convention
        discovery_date: new Date().toISOString(),
        discovery_context: {
          search_query: query,
          search_type: 'google_pse',
          confidence: channel.confidence,
          video_title: channel.videoTitle,
          video_url: channel.videoUrl
        },
        channel_metadata: {
          name: channel.actualTitle || channel.channelName,
          title: channel.actualTitle || channel.channelName,
          url: channel.channelUrl,
          source: channel.source,
          description: channel.description || '',
          subscriber_count: channel.subscriberCount || 0,
          video_count: channel.videoCount || 0,
          thumbnail_url: channel.thumbnailUrl || ''
        },
        subscriber_count: channel.subscriberCount || 0,
        video_count: channel.videoCount || 0,
        relevance_score: channel.confidence === 'high' ? 0.9 : channel.confidence === 'medium' ? 0.7 : 0.5,
        validation_status: 'pending',
        import_status: 'pending'
      }));

      // Insert discovery records - using insert instead of upsert since we have unique constraint
      if (discoveryRecords.length > 0) {
        const { error: discoveryError } = await supabase
          .from('channel_discovery')
          .insert(discoveryRecords);

        if (discoveryError) {
          // Only log if it's not a duplicate key error
          if (discoveryError.code !== '23505') {
            console.error('Error inserting into channel_discovery:', discoveryError);
          } else {
            console.log(`Skipped ${discoveryRecords.length} channels already in discovery table`);
          }
        }
      }
    }

    // Get the top result
    const topResult = channels[0] ? {
      title: channels[0].channelName,
      channelUrl: channels[0].channelUrl,
      confidence: channels[0].confidence,
      videoTitle: channels[0].videoTitle,
      subscribers: 0, // Would need another API call to get this
      autoApproved: false // Would be determined by your approval logic
    } : null;

    // Include filter information in the response
    let filteredCount = 0;
    let channelsAddedCount = 0;
    
    if (newChannels.length > 0 && enrichedChannels) {
      filteredCount = enrichedChannels.filter(c => !c.meetsFilters).length;
      channelsAddedCount = enrichedChannels.filter(c => c.meetsFilters).length;
    }
    
    const result: any = {
      query,
      channelsFound: channels.length,
      channelsAdded: channelsAddedCount,
      duplicates: duplicateCount,
      filtered: filteredCount,
      totalResults: searchResult.totalResults,
      channels: channels.map(c => {
        // Find the enriched version if it exists
        const enriched = enrichedChannels?.find(e => e.channelUrl === c.channelUrl);
        
        return {
          name: c.channelName,
          url: c.channelUrl,
          channelId: c.channelId,
          confidence: c.confidence,
          source: c.source,
          videoTitle: c.videoTitle,
          videoUrl: c.videoUrl,
          isNew: newChannels.some(nc => nc.channelUrl === c.channelUrl),
          meetsFilters: enriched?.meetsFilters,
          filterReasons: enriched?.filterReasons,
          subscriberCount: enriched?.subscriberCount,
          lastVideoDate: enriched?.lastVideoDate
        };
      }),
      topResult,
      timestamp: new Date().toISOString()
    };
    
    // Include raw results if debug mode is on
    if (includeDebug && searchResult.rawResults) {
      result.rawResults = searchResult.rawResults;
    }

    console.log(`✅ PSE Search complete: found ${channels.length} channels (${newChannels.length} new)`);

    return NextResponse.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('PSE search error:', error);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}