import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

export async function GET() {
  const supabase = getSupabase();
  try {
    // Get channel format consistency
    const { data: channelData } = await supabase
      .from('format_detection_feedback')
      .select('channel_name, final_format')
      .not('channel_name', 'is', null);
    
    if (!channelData || channelData.length === 0) {
      return NextResponse.json({ channels: [] });
    }
    
    // Calculate channel profiles
    const channelFormats: Record<string, Record<string, number>> = {};
    channelData.forEach(d => {
      if (!channelFormats[d.channel_name]) {
        channelFormats[d.channel_name] = {};
      }
      channelFormats[d.channel_name][d.final_format] = 
        (channelFormats[d.channel_name][d.final_format] || 0) + 1;
    });
    
    // Find channels with consistent formats (80%+ in one format)
    const consistentChannels = [];
    for (const [channel, formats] of Object.entries(channelFormats)) {
      const total = Object.values(formats).reduce((sum, count) => sum + count, 0);
      if (total >= 5) { // Only channels with 5+ videos
        for (const [format, count] of Object.entries(formats)) {
          const percentage = (count / total * 100);
          if (percentage >= 80) {
            consistentChannels.push({
              channel,
              dominantFormat: format,
              confidence: percentage.toFixed(0),
              videoCount: total
            });
          }
        }
      }
    }
    
    // Sort by video count
    consistentChannels.sort((a, b) => b.videoCount - a.videoCount);
    
    return NextResponse.json({ 
      channels: consistentChannels.slice(0, 20), // Top 20 channels
      totalProfiled: consistentChannels.length
    });
    
  } catch (error) {
    console.error('Error fetching channel profiles:', error);
    return NextResponse.json({ error: 'Failed to fetch channel profiles' }, { status: 500 });
  }
}