import { NextRequest, NextResponse } from 'next/server';
import { YouTubeChannelSpider } from '@/lib/youtube-channel-spider';
import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const { seedChannelId, config } = await request.json();
    
    if (!seedChannelId) {
      return NextResponse.json(
        { error: 'seedChannelId is required' },
        { status: 400 }
      );
    }
    
    // Get auth token
    const headersList = await headers();
    const authorization = headersList.get('authorization');
    const token = authorization?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Create supabase client to get user
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            authorization: `Bearer ${token}`
          }
        }
      }
    );
    
    const { data: { user } } = await supabase.auth.getUser();
    
    // Default config
    const spiderConfig = {
      minSubscribers: config?.minSubscribers || 10000,
      maxDaysSinceUpload: config?.maxDaysSinceUpload || 90,
      maxChannels: config?.maxChannels || 50,
      maxDepth: config?.maxDepth || 2,
      batchSize: config?.batchSize || 10
    };
    
    // Create spider instance
    const spider = new YouTubeChannelSpider(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      spiderConfig
    );
    
    // For testing, limit to very small numbers
    const testConfig = {
      ...spiderConfig,
      maxChannels: Math.min(spiderConfig.maxChannels, 5), // Max 5 for testing
      maxDepth: Math.min(spiderConfig.maxDepth, 1) // Max depth 1 for testing
    };
    
    // Run spider in test mode
    console.log('Starting spider test with config:', testConfig);
    
    try {
      const discovered = await spider.spider(seedChannelId, user?.id);
      
      return NextResponse.json({
        success: true,
        message: `Successfully discovered ${discovered.length} channels`,
        seedChannelId,
        config: testConfig,
        discovered: discovered.map(ch => ({
          channelId: ch.channelId,
          channelTitle: ch.channelTitle,
          channelHandle: ch.channelHandle,
          subscriberCount: ch.subscriberCount,
          discoveryMethod: ch.discoveryMethod,
          depth: ch.depth
        })),
        note: 'Test run limited to 5 channels at depth 1'
      });
    } catch (spiderError) {
      console.error('Spider execution error:', spiderError);
      return NextResponse.json({
        error: 'Spider execution failed',
        details: spiderError instanceof Error ? spiderError.message : 'Unknown error',
        config: testConfig
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('Spider error:', error);
    return NextResponse.json(
      { error: 'Failed to run spider' },
      { status: 500 }
    );
  }
}