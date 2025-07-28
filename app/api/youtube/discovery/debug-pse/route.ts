/**
 * Debug PSE Discovery - See exactly what's happening
 */

import { NextRequest, NextResponse } from 'next/server';
import { googlePSE } from '@/lib/google-pse-service';
import { queryGenerator } from '@/lib/discovery-query-generator';

export async function POST(request: NextRequest) {
  try {
    const { queryCount = 3 } = await request.json();
    
    // Generate queries
    const queries = await queryGenerator.generateQueries(queryCount);
    
    const debugResults = [];
    
    for (const queryInfo of queries) {
      console.log(`\n🔍 Searching: "${queryInfo.query}"`);
      
      const result = await googlePSE.searchYouTube(queryInfo.query, {
        num: 10,
        type: 'video'
      });
      
      debugResults.push({
        query: queryInfo.query,
        category: queryInfo.category,
        totalResults: result.totalResults,
        channelsFound: result.results.length,
        channels: result.results.map(ch => ({
          name: ch.channelName,
          url: ch.channelUrl,
          hasId: !!ch.channelId,
          confidence: ch.confidence
        }))
      });
    }
    
    // Summary
    const totalChannels = debugResults.reduce((sum, r) => sum + r.channelsFound, 0);
    const uniqueChannels = new Set(
      debugResults.flatMap(r => r.channels.map(ch => ch.url))
    ).size;
    
    return NextResponse.json({
      queriesRun: queryCount,
      totalChannelsFound: totalChannels,
      uniqueChannelsFound: uniqueChannels,
      averageChannelsPerQuery: totalChannels / queryCount,
      details: debugResults
    });
    
  } catch (error) {
    console.error('Debug PSE error:', error);
    return NextResponse.json({
      error: 'Debug failed',
      details: error.message
    }, { status: 500 });
  }
}