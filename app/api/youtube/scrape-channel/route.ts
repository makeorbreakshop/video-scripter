import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Extract channel identifier from URL
    const channelIdMatch = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/);
    const handleMatch = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/);
    const customUrlMatch = url.match(/youtube\.com\/c\/([a-zA-Z0-9_-]+)/);
    const userMatch = url.match(/youtube\.com\/user\/([a-zA-Z0-9_-]+)/);

    let channelId = null;
    let channelIdentifier = null;
    let identifierType = null;

    if (channelIdMatch) {
      channelId = channelIdMatch[1];
      identifierType = 'channel';
    } else if (handleMatch) {
      channelIdentifier = '@' + handleMatch[1];
      identifierType = 'handle';
    } else if (customUrlMatch) {
      channelIdentifier = customUrlMatch[1];
      identifierType = 'custom';
    } else if (userMatch) {
      channelIdentifier = userMatch[1];
      identifierType = 'user';
    }

    if (!channelId && !channelIdentifier) {
      return NextResponse.json(
        { error: 'Invalid YouTube channel URL' },
        { status: 400 }
      );
    }

    // If we already have the channel ID, we can skip scraping
    if (channelId) {
      // Check if channel is already imported
      const importStatus = await checkChannelImportStatus(channelId);
      
      const response = {
        channelId,
        identifierType,
        needsScraping: false,
        isAlreadyImported: importStatus.isExisting,
        importSource: importStatus.source
      };
      
      console.log('Scrape-channel response (direct ID):', response);
      
      return NextResponse.json(response);
    }

    // For handle/custom/user URLs, we need to scrape to get the channel ID
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch YouTube page');
      }

      const html = await response.text();
      
      // More specific patterns to find the CURRENT channel (not recommended channels)
      // Look for patterns that specifically identify the browsed channel
      const patterns = [
        // Look for the canonical URL which contains the current channel
        /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/([UC][a-zA-Z0-9_-]{22})">/,
        // Look in the page's metadata
        /<meta itemprop="channelId" content="([UC][a-zA-Z0-9_-]{22})">/,
        // Look for browse endpoint for the current channel
        /"browseEndpoint":\s*{\s*"browseId":\s*"([UC][a-zA-Z0-9_-]{22})"/,
        // Look for the channel header data
        /"channelMetadataRenderer":\s*{[^}]*"externalId":\s*"([UC][a-zA-Z0-9_-]{22})"/,
        // Look for current channel in header
        /"c4TabbedHeaderRenderer":\s*{[^}]*"channelId":\s*"([UC][a-zA-Z0-9_-]{22})"/,
        // Look for the channel URL in og:url meta tag
        /<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/([UC][a-zA-Z0-9_-]{22})">/
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          channelId = match[1];
          console.log(`Found channel ID using pattern: ${pattern.source.substring(0, 50)}...`);
          break;
        }
      }

      // If still not found, try to find the channel ID in the initial data
      if (!channelId) {
        // Look for ytInitialData which contains the channel info
        const ytInitialDataMatch = html.match(/var ytInitialData = ({.+?});/s);
        if (ytInitialDataMatch) {
          try {
            const ytData = JSON.parse(ytInitialDataMatch[1]);
            // Navigate through the data structure to find the channel ID
            const channelIdFromData = 
              ytData?.metadata?.channelMetadataRenderer?.externalId ||
              ytData?.header?.c4TabbedHeaderRenderer?.channelId ||
              ytData?.microformat?.microformatDataRenderer?.urlCanonical?.match(/\/channel\/([UC][a-zA-Z0-9_-]{22})/)?.[1];
            
            if (channelIdFromData) {
              channelId = channelIdFromData;
              console.log('Found channel ID in ytInitialData');
            }
          } catch (e) {
            console.error('Failed to parse ytInitialData:', e);
          }
        }
      }

      if (channelId) {
        // Check if channel is already imported
        const importStatus = await checkChannelImportStatus(channelId);
        
        const response = {
          channelId,
          channelIdentifier,
          identifierType,
          needsScraping: true,
          isAlreadyImported: importStatus.isExisting,
          importSource: importStatus.source
        };
        
        console.log('Scrape-channel response:', response);
        
        return NextResponse.json(response);
      } else {
        return NextResponse.json(
          { error: 'Could not extract channel ID from page' },
          { status: 404 }
        );
      }

    } catch (scrapeError) {
      console.error('Scraping error:', scrapeError);
      return NextResponse.json(
        { error: 'Failed to scrape channel information' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Error processing channel URL:', error);
    return NextResponse.json(
      { error: 'Failed to process channel URL' },
      { status: 500 }
    );
  }
}

async function checkChannelImportStatus(channelId: string): Promise<{ isExisting: boolean; source: string | null }> {
  console.log(`Checking import status for channel: ${channelId}`);
  
  try {
    // Check if it's a competitor channel
    const { data: competitorStatus, error: competitorError } = await supabase
      .from('channel_import_status')
      .select('id')
      .eq('channel_id', channelId)
      .maybeSingle(); // Use maybeSingle to avoid error when no row exists
    
    console.log('Competitor check:', { competitorStatus, competitorError: competitorError?.message });
    
    // If we found a competitor status
    if (competitorStatus) {
      console.log('Channel found in competitor import status');
      return { isExisting: true, source: 'competitor' };
    }
    
    // Check if it's in the videos table (discovery or other sources)
    const { data: videoData, error: videoError } = await supabase
      .from('videos')
      .select('channel_id')
      .eq('channel_id', channelId)
      .limit(1);
    
    console.log('Videos check:', { videoCount: videoData?.length, videoError: videoError?.message });
    
    if (!videoError && videoData && videoData.length > 0) {
      console.log('Channel found in videos table');
      return { isExisting: true, source: 'discovery' };
    }
    
    console.log('Channel not found in any table');
    return { isExisting: false, source: null };
  } catch (error) {
    console.error('Error checking channel import status:', error);
    // Only return false if there's an unexpected error
    return { isExisting: false, source: null };
  }
}