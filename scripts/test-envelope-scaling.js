import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testEnvelopeScaling() {
  try {
    // Get envelope data at day 7 and day 20
    const { data: envelopeData } = await supabase
      .from('performance_envelopes')
      .select('*')
      .in('day_since_published', [7, 20, 30, 60, 90])
      .order('day_since_published');
    
    console.log('Performance Envelope Reference Points:');
    envelopeData.forEach(env => {
      console.log(`\nDay ${env.day_since_published}:`);
      console.log(`  P10: ${env.p10_views.toLocaleString()}`);
      console.log(`  P25: ${env.p25_views.toLocaleString()}`);
      console.log(`  P50: ${env.p50_views.toLocaleString()}`);
      console.log(`  P75: ${env.p75_views.toLocaleString()}`);
      console.log(`  P90: ${env.p90_views.toLocaleString()}`);
    });
    
    // Test scaling for "I Like To Make Stuff" channel
    const channelBaseline = 1397; // VPD
    console.log('\n\nChannel: I Like To Make Stuff');
    console.log('Baseline VPD:', channelBaseline);
    console.log('Expected views at day 7:', channelBaseline * 7);
    console.log('Expected views at day 20:', channelBaseline * 20);
    
    // Find the right scale factor
    const day7Envelope = envelopeData.find(e => e.day_since_published === 7);
    if (day7Envelope) {
      const expectedDay7 = channelBaseline * 7;
      const scaleFactor = expectedDay7 / day7Envelope.p50_views;
      
      console.log('\nScaling calculation:');
      console.log('Global P50 at day 7:', day7Envelope.p50_views);
      console.log('Scale factor:', scaleFactor.toFixed(4));
      
      console.log('\nScaled envelope at day 20:');
      const day20Envelope = envelopeData.find(e => e.day_since_published === 20);
      if (day20Envelope) {
        console.log('P10:', Math.round(day20Envelope.p10_views * scaleFactor).toLocaleString());
        console.log('P50:', Math.round(day20Envelope.p50_views * scaleFactor).toLocaleString());
        console.log('P90:', Math.round(day20Envelope.p90_views * scaleFactor).toLocaleString());
      }
    }
    
    // Check actual video performance
    const { data: video } = await supabase
      .from('videos')
      .select('*')
      .eq('channel_name', 'I Like To Make Stuff')
      .ilike('title', '%Hiding Sliding Doors%')
      .single();
    
    if (video) {
      console.log('\n\nActual Video Performance:');
      console.log('Title:', video.title);
      console.log('Views:', video.view_count);
      console.log('Published:', video.published_at);
      const ageDays = Math.floor((Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24));
      console.log('Age (days):', ageDays);
      console.log('Actual VPD:', Math.round(video.view_count / ageDays));
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testEnvelopeScaling();