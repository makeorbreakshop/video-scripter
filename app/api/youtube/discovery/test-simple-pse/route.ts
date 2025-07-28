/**
 * Simple PSE Test - Minimal implementation to verify PSE is working
 */

import { NextRequest, NextResponse } from 'next/server';
import { googlePSE } from '@/lib/google-pse-service';

export async function GET(request: NextRequest) {
  try {
    // Single search
    const query = 'python programming tutorial 2025';
    console.log(`\nTesting PSE with query: "${query}"`);
    
    const result = await googlePSE.searchYouTube(query, {
      num: 10,
      type: 'video'
    });
    
    console.log(`Found ${result.results.length} channels`);
    console.log('Channels:', result.results.map(ch => ({
      name: ch.channelName,
      url: ch.channelUrl
    })));
    
    // Now test batch search
    const queries = [
      'javascript tutorial',
      'react hooks explained',
      'python data science'
    ];
    
    console.log(`\nTesting batch search with ${queries.length} queries`);
    
    const batchResult = await googlePSE.batchSearchYouTube(queries, {
      type: 'video',
      dedupeChannels: true
    });
    
    console.log(`Batch search found ${batchResult.channels.length} unique channels`);
    console.log(`Total searches: ${batchResult.totalSearches}`);
    console.log(`Errors: ${batchResult.errors.length}`);
    
    return NextResponse.json({
      singleSearch: {
        query,
        channelsFound: result.results.length,
        channels: result.results.slice(0, 5).map(ch => ch.channelName)
      },
      batchSearch: {
        queries: queries.length,
        channelsFound: batchResult.channels.length,
        uniqueChannels: new Set(batchResult.channels.map(ch => ch.channelUrl)).size,
        sampleChannels: batchResult.channels.slice(0, 10).map(ch => ({
          name: ch.channelName,
          url: ch.channelUrl
        }))
      }
    });
    
  } catch (error) {
    console.error('Simple PSE test error:', error);
    return NextResponse.json({
      error: 'Test failed',
      details: error.message
    }, { status: 500 });
  }
}