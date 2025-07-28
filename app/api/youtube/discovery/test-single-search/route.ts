/**
 * Test Single Search - Debug Google PSE Response
 * Let's see exactly what Google returns so we can parse it correctly
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.GOOGLE_PSE_API_KEY;
    const engineId = process.env.GOOGLE_PSE_ENGINE_ID;
    
    if (!apiKey || !engineId) {
      return NextResponse.json({ 
        error: 'Missing Google PSE credentials',
        setup: 'Add GOOGLE_PSE_API_KEY and GOOGLE_PSE_ENGINE_ID to .env'
      }, { status: 500 });
    }

    // Simple, targeted search query
    const query = 'javascript tutorial for beginners';
    
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', engineId);
    url.searchParams.set('q', query);
    url.searchParams.set('num', '5'); // Just 5 results to analyze
    
    console.log('Searching for:', query);
    console.log('API URL:', url.toString().replace(apiKey, 'API_KEY_HIDDEN'));
    
    const response = await fetch(url.toString());
    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json({ 
        error: 'Google PSE API error',
        status: response.status,
        details: data
      }, { status: response.status });
    }

    // Let's examine the structure
    const results = {
      query,
      totalResults: data.searchInformation?.totalResults,
      searchTime: data.searchInformation?.searchTime,
      itemsReturned: data.items?.length || 0,
      rawFirstItem: data.items?.[0] || null,
      
      // Try to extract channel info from each result
      parsedResults: data.items?.map((item: any, index: number) => {
        const url = item.link || '';
        
        // Try different extraction methods
        const videoIdMatch = url.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
        const channelIdMatch = url.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]+)/);
        const userMatch = url.match(/youtube\.com\/user\/([a-zA-Z0-9_-]+)/);
        const handleMatch = url.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/);
        
        return {
          index,
          title: item.title,
          link: url,
          snippet: item.snippet,
          
          // What we found
          isVideo: !!videoIdMatch,
          videoId: videoIdMatch?.[1] || null,
          isChannel: !!channelIdMatch || !!userMatch || !!handleMatch,
          channelId: channelIdMatch?.[1] || null,
          channelHandle: handleMatch?.[1] || null,
          userName: userMatch?.[1] || null,
          
          // Check for channel info in metadata
          pagemap: {
            hasVideoObject: !!item.pagemap?.videoobject,
            videoAuthor: item.pagemap?.videoobject?.[0]?.author || null,
            videoChannelId: item.pagemap?.videoobject?.[0]?.channelid || null,
            
            hasPerson: !!item.pagemap?.person,
            personName: item.pagemap?.person?.[0]?.name || null,
            personUrl: item.pagemap?.person?.[0]?.url || null,
            
            metatags: item.pagemap?.metatags?.[0] || {}
          }
        };
      }) || []
    };

    return NextResponse.json(results, { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Test search error:', error);
    return NextResponse.json({ 
      error: 'Test failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}