import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixWillTennysonSimple() {
  console.log('Fixing Will Tennyson baselines using proper calculation...');
  
  // Get all Will Tennyson videos
  const { data: videos, error: fetchError } = await supabase
    .from('videos')
    .select('id, title, view_count, channel_baseline_at_publish')
    .eq('channel_name', 'Will Tennyson')
    .eq('is_short', false)
    .order('published_at', { ascending: true });
  
  if (fetchError) {
    console.error('Error fetching videos:', fetchError);
    return;
  }
  
  console.log(`Found ${videos.length} Will Tennyson videos`);
  
  let updated = 0;
  const updates = [];
  
  // Calculate proper baseline for each video
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    
    // Call the database function with proper parameter name
    const { data, error } = await supabase.rpc('calculate_video_channel_baseline', {
      p_video_id: video.id
    });
    
    if (error) {
      console.error(`Error calculating baseline for ${video.id}:`, error.message);
      continue;
    }
    
    const newBaseline = parseFloat(data);
    
    // Only update if different
    if (Math.abs((video.channel_baseline_at_publish || 0) - newBaseline) > 0.001) {
      updates.push({
        id: video.id,
        baseline: newBaseline,
        score: video.view_count / (newBaseline * 29742)
      });
      
      // Update the video
      const { error: updateError } = await supabase
        .from('videos')
        .update({ 
          channel_baseline_at_publish: newBaseline,
          temporal_performance_score: Math.min(video.view_count / (newBaseline * 29742), 99999.999)
        })
        .eq('id', video.id);
      
      if (updateError) {
        console.error(`Error updating ${video.id}:`, updateError);
      } else {
        updated++;
      }
    }
    
    if ((i + 1) % 50 === 0) {
      console.log(`Progress: ${i + 1}/${videos.length} videos processed, ${updated} updated`);
    }
  }
  
  console.log(`\nComplete! Updated ${updated} videos`);
  
  // Show variety in baselines
  if (updates.length > 0) {
    const uniqueBaselines = new Set(updates.map(u => u.baseline.toFixed(3)));
    console.log(`Unique baseline values: ${uniqueBaselines.size}`);
    
    // Show first 10 and last 10 for variety check
    console.log('\nFirst 5 videos:');
    updates.slice(0, 5).forEach(u => {
      console.log(`  Baseline: ${u.baseline.toFixed(3)} (${Math.round(u.baseline * 29742)} views)`);
    });
    
    console.log('\nLast 5 videos:');
    updates.slice(-5).forEach(u => {
      console.log(`  Baseline: ${u.baseline.toFixed(3)} (${Math.round(u.baseline * 29742)} views)`);
    });
  }
}

fixWillTennysonSimple().catch(console.error);